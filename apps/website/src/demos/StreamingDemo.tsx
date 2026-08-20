import {
  createCamera,
  panCamera,
  screenToWorld,
  VisibilityTracker,
  worldToScreen,
  worldViewport,
  zoomCameraAt,
  type Camera,
} from "@dopejs/deckle";
import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  advanceStreamingCanvasSession,
  EMPTY_STREAMING_CANVAS_VIEW,
  newStreamingCanvasSession,
  streamingCanvasViewOf,
  type StreamingCanvasSession,
  type StreamingCanvasView,
  type StreamingCardSession,
} from "./streaming-demo-model";

const WIDTH = 960;
const HEIGHT = 560;

interface StreamingCanvasMetrics {
  readonly zoom: number;
  readonly visible: number;
  readonly selected: string;
  readonly drawMs: number;
}

interface CardRenderState {
  readonly lifecycle: string;
  readonly pending: string | null;
  readonly html: string;
  readonly received: number;
  readonly total: number;
  readonly progress: number;
  readonly complete: boolean;
}

const INITIAL_CANVAS_METRICS: StreamingCanvasMetrics = {
  zoom: 0.78,
  visible: 0,
  selected: "—",
  drawMs: 0,
};

export interface StreamingDemoLabels {
  readonly play: string;
  readonly pause: string;
  readonly step: string;
  readonly reset: string;
  readonly speed: string;
}

function canvasPoint(canvas: HTMLCanvasElement, event: PointerEvent | WheelEvent) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - bounds.left) / bounds.width) * WIDTH,
    y: ((event.clientY - bounds.top) / bounds.height) * HEIGHT,
  };
}

function cardRenderState(
  session: StreamingCanvasSession,
  card: StreamingCardSession,
): CardRenderState {
  const record = session.store.get(card.handle);
  const update = card.sanitizer.current;
  const received = card.sanitizer.source.length;
  return {
    lifecycle: record.lifecycle,
    pending: update.pending,
    html: card.html,
    received,
    total: card.spec.source.length,
    progress: card.spec.source.length === 0 ? 1 : received / card.spec.source.length,
    complete: card.ingestion.settled,
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

function drawLoadingSkeleton(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  scale: number,
  dark: boolean,
): void {
  for (const [index, line] of [0.72, 0.9, 0.58].entries()) {
    context.fillStyle = dark ? "#2a3443" : "#e3e8ee";
    context.fillRect(x, y + index * 25 * scale, width * line, 8 * scale);
  }
}

function drawCardFrame(
  context: CanvasRenderingContext2D,
  card: StreamingCardSession,
  camera: Camera,
  state: CardRenderState,
  dark: boolean,
  selected: boolean,
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  const { spec } = card;
  const topLeft = worldToScreen(camera, spec.frame);
  const width = spec.frame.width * camera.zoom;
  const height = spec.frame.height * camera.zoom;
  const scale = camera.zoom;
  const radius = 8 * Math.min(scale, 1);
  const frame = new Path2D();
  frame.roundRect(topLeft.x, topLeft.y, width, height, radius);

  context.fillStyle = dark ? "#171e29" : "#ffffff";
  context.fill(frame);
  context.save();
  context.clip(frame);
  context.fillStyle = dark
    ? `hsl(${String(spec.hue)} 32% 19%)`
    : `hsl(${String(spec.hue)} 55% 94%)`;
  context.fillRect(topLeft.x, topLeft.y, width, 34 * scale);
  context.fillStyle = dark ? "#dfe6f0" : "#27313e";
  context.font = `${String(12 * Math.min(scale, 1.1))}px ui-monospace, monospace`;
  context.fillText(spec.title, topLeft.x + 12 * scale, topLeft.y + 22 * scale, width * 0.62);

  const status = state.complete ? "COMMITTED" : state.lifecycle.toLocaleUpperCase();
  context.textAlign = "right";
  context.fillStyle = state.complete ? "#48b979" : dark ? "#8eb0ff" : "#1e66f5";
  context.fillText(status, topLeft.x + width - 12 * scale, topLeft.y + 22 * scale, width * 0.34);
  context.textAlign = "start";

  context.fillStyle = dark ? "#273243" : "#e2e7ee";
  context.fillRect(topLeft.x, topLeft.y + height - 4 * scale, width, 4 * scale);
  context.fillStyle = state.complete ? "#48b979" : dark ? "#7ca2ff" : "#1e66f5";
  context.fillRect(topLeft.x, topLeft.y + height - 4 * scale, width * state.progress, 4 * scale);
  context.restore();

  context.strokeStyle = selected
    ? dark
      ? "#8eb0ff"
      : "#1e66f5"
    : state.complete
      ? dark
        ? `hsl(${String(spec.hue)} 30% 35%)`
        : `hsl(${String(spec.hue)} 30% 70%)`
      : dark
        ? "#7ca2ff"
        : "#1e66f5";
  context.lineWidth = selected ? 3 : state.complete ? 1 : 2;
  if (!state.complete) context.setLineDash([7, 5]);
  context.stroke(frame);
  context.setLineDash([]);
  return { x: topLeft.x, y: topLeft.y, width, height };
}

function drawCompactCard(
  context: CanvasRenderingContext2D,
  card: StreamingCardSession,
  camera: Camera,
  state: CardRenderState,
  dark: boolean,
  selected: boolean,
): void {
  const frame = drawCardFrame(context, card, camera, state, dark, selected);
  const scale = camera.zoom;
  const contentX = frame.x + 16 * scale;
  const contentY = frame.y + 55 * scale;
  const contentWidth = frame.width - 32 * scale;
  context.save();
  context.beginPath();
  context.rect(frame.x, frame.y + 34 * scale, frame.width, frame.height - 38 * scale);
  context.clip();

  if (state.html === "") {
    drawLoadingSkeleton(context, contentX, contentY, contentWidth, scale, dark);
  } else if (card.spec.kind === "chart") {
    const targets = [0.42, 0.68, 0.54, 0.86];
    targets.forEach((target, index) => {
      const reveal = Math.max(0, Math.min(1, state.progress * 2.2 - index * 0.18));
      const barWidth = 35 * scale;
      const barHeight = target * reveal * 108 * scale;
      context.fillStyle = `hsl(${String(card.spec.hue)} 55% ${dark ? "48%" : "60%"})`;
      context.fillRect(
        frame.x + (28 + index * 55) * scale,
        frame.y + frame.height - 20 * scale - barHeight,
        barWidth,
        barHeight,
      );
    });
  } else {
    const availableLines = card.spec.kind === "brief" ? 4 : 5;
    const visibleLines = Math.max(1, Math.ceil(state.progress * availableLines));
    const widths =
      card.spec.kind === "brief" ? [0.62, 0.88, 0.76, 0.54] : [0.9, 0.72, 0.86, 0.58, 0.78];
    for (let index = 0; index < visibleLines; index += 1) {
      context.fillStyle = dark ? "#7f8c9e" : "#687586";
      context.fillRect(
        contentX,
        contentY + index * 25 * scale,
        contentWidth * widths[index]!,
        7 * scale,
      );
    }
  }
  context.restore();
}

function drawReportCard(
  context: CanvasRenderingContext2D,
  card: StreamingCardSession,
  camera: Camera,
  state: CardRenderState,
  dark: boolean,
  selected: boolean,
): void {
  const frame = drawCardFrame(context, card, camera, state, dark, selected);
  const scale = camera.zoom;
  const contentX = frame.x + 30 * scale;
  let contentY = frame.y + 86 * scale;
  const safeHtml = state.html;
  context.save();
  context.beginPath();
  context.rect(frame.x, frame.y + 34 * scale, frame.width, frame.height - 38 * scale);
  context.clip();

  if (!safeHtml.includes("Q3 revenue")) {
    drawLoadingSkeleton(context, contentX, contentY, frame.width - 60 * scale, scale, dark);
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
    context.fillRect(contentX, contentY, frame.width - 60 * scale, 30 * scale);
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
  context.restore();

  if (!state.complete && state.pending !== null) {
    const tag = `WITHHELD · ${state.pending}`;
    context.font = `${String(11 * Math.min(scale, 1.1))}px ui-monospace, monospace`;
    const tagWidth = context.measureText(tag).width + 18 * scale;
    context.fillStyle = dark ? "#4b341b" : "#fff0d8";
    context.beginPath();
    context.roundRect(
      frame.x + frame.width - tagWidth - 12 * scale,
      frame.y + frame.height + 10 * scale,
      tagWidth,
      25 * scale,
      5 * scale,
    );
    context.fill();
    context.fillStyle = dark ? "#ffc477" : "#9b5b00";
    context.fillText(
      tag,
      frame.x + frame.width - tagWidth - 3 * scale,
      frame.y + frame.height + 27 * scale,
    );
  }
}

function drawEmptyCanvas(context: CanvasRenderingContext2D, dark: boolean): void {
  context.textAlign = "center";
  context.fillStyle = dark ? "#7f8a99" : "#6d7785";
  context.font = "12px ui-monospace, monospace";
  context.fillText("WAITING FOR AGENT · FIRST FRAME NOT ANNOUNCED", WIDTH / 2, HEIGHT / 2 - 6);
  context.fillStyle = dark ? "#2c3747" : "#d9dfe7";
  context.fillRect(WIDTH / 2 - 110, HEIGHT / 2 + 14, 220, 3);
  context.textAlign = "start";
}

export function StreamingDemo({ labels }: { readonly labels: StreamingDemoLabels }): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef<StreamingCanvasSession | null>(null);
  const canvasRuntimeRef = useRef<{ redraw: () => void; reset: () => void } | null>(null);
  const timerRef = useRef<number | null>(null);
  const speedRef = useRef(28);
  const [view, setView] = useState<StreamingCanvasView>(EMPTY_STREAMING_CANVAS_VIEW);
  const [metrics, setMetrics] = useState<StreamingCanvasMetrics>(INITIAL_CANVAS_METRICS);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(28);

  const publish = (session: StreamingCanvasSession): void => {
    setView(streamingCanvasViewOf(session));
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
    const session = newStreamingCanvasSession();
    sessionRef.current = session;
    publish(session);
    canvasRuntimeRef.current?.reset();
  };

  const advance = (): boolean => {
    const session = sessionRef.current;
    if (session === null) return false;
    const active = advanceStreamingCanvasSession(session, speedRef.current || 1);
    publish(session);
    return active;
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
    let selectedId: string | null = null;
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

      if (session.cards.length === 0) drawEmptyCanvas(context, dark);
      const drawable = session.cards
        .filter((card) => visible.has(card.spec.id))
        .toSorted((a, b) => a.spec.frame.zIndex - b.spec.frame.zIndex);
      for (const card of drawable) {
        const state = cardRenderState(session, card);
        if (card.spec.kind === "report") {
          drawReportCard(context, card, camera, state, dark, selectedId === card.spec.id);
        } else {
          drawCompactCard(context, card, camera, state, dark, selectedId === card.spec.id);
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
      selectedId = null;
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
          const first =
            sessionRef.current?.cards.find((card) => card.spec.id === a)?.spec.frame.zIndex ?? 0;
          const second =
            sessionRef.current?.cards.find((card) => card.spec.id === b)?.spec.frame.zIndex ?? 0;
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
    const session = newStreamingCanvasSession();
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
          aria-label="Cards added and loaded on an interactive infinite canvas"
        />
        <dl className="demo-hud demo-hud--streaming" aria-live="polite">
          <div>
            <dt>cards / visible</dt>
            <dd>
              {view.announced} / {view.total} · {metrics.visible}
            </dd>
          </div>
          <div>
            <dt>loading / streaming / committed</dt>
            <dd>
              {view.loading} / {view.streaming} / {view.committed}
            </dd>
          </div>
          <div>
            <dt>received / safe / blocked</dt>
            <dd>
              {view.received} / {view.safe} / {view.diagnostics}
            </dd>
          </div>
          <div>
            <dt>zoom / draft paint / draw</dt>
            <dd>
              {metrics.zoom.toFixed(2)} / {view.draftRevision}:{view.paintRevision} /{" "}
              {metrics.drawMs.toFixed(2)} ms
            </dd>
          </div>
        </dl>
        <div className="stream-canvas__status" aria-live="polite">
          <span>{metrics.selected}</span>
          <span>{view.pinned} pinned</span>
          <span>{view.pending}</span>
        </div>
      </div>
    </div>
  );
}
