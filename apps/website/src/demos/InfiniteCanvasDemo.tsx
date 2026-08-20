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
import { selectLod } from "@dopejs/deckle-renderer";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { buildDemoScene } from "./demo-scene";

const WIDTH = 960;
const HEIGHT = 560;

interface CanvasMetrics {
  readonly zoom: number;
  readonly visible: number;
  readonly overscan: number;
  readonly warm: number;
  readonly cold: number;
  readonly selected: string;
  readonly drawMs: number;
}

const INITIAL_METRICS: CanvasMetrics = {
  zoom: 0.8,
  visible: 0,
  overscan: 0,
  warm: 0,
  cold: 500,
  selected: "—",
  drawMs: 0,
};

function canvasPoint(canvas: HTMLCanvasElement, event: PointerEvent | WheelEvent) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - bounds.left) / bounds.width) * WIDTH,
    y: ((event.clientY - bounds.top) / bounds.height) * HEIGHT,
  };
}

export function InfiniteCanvasDemo(): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [metrics, setMetrics] = useState<CanvasMetrics>(INITIAL_METRICS);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas === null || context === null || context === undefined) return;

    const dpr = Math.max(1, Math.min(3, globalThis.devicePixelRatio || 1));
    canvas.width = Math.round(WIDTH * dpr);
    canvas.height = Math.round(HEIGHT * dpr);
    const { store, artifacts } = buildDemoScene(2026, 500);
    const anchor = artifacts.get("artifact-0")!;
    const tracker = new VisibilityTracker();
    let camera: Camera = createCamera({
      x: anchor.frame.x,
      y: anchor.frame.y,
      zoom: 0.8,
      viewportWidth: WIDTH,
      viewportHeight: HEIGHT,
    });
    let selectedId: string | null = null;
    let dragging = false;
    let moved = false;
    let lastPoint = { x: 0, y: 0 };

    const draw = (): void => {
      const started = performance.now();
      const dark = document.documentElement.dataset.theme === "dark";
      const sets = tracker.compute(store, camera);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, WIDTH, HEIGHT);
      context.fillStyle = dark ? "#0d131e" : "#f6f7f9";
      context.fillRect(0, 0, WIDTH, HEIGHT);

      context.strokeStyle = dark ? "#1e2938" : "#e2e6eb";
      context.lineWidth = 1;
      for (let x = 0; x <= WIDTH; x += 40) {
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, HEIGHT);
        context.stroke();
      }
      for (let y = 0; y <= HEIGHT; y += 40) {
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(WIDTH, y);
        context.stroke();
      }

      const drawable = [...sets.visible]
        .map((id) => artifacts.get(id))
        .filter((artifact) => artifact !== undefined)
        .sort((a, b) => a.frame.zIndex - b.frame.zIndex || a.id.localeCompare(b.id));

      for (const artifact of drawable) {
        const topLeft = worldToScreen(camera, { x: artifact.frame.x, y: artifact.frame.y });
        const width = artifact.frame.width * camera.zoom;
        const height = artifact.frame.height * camera.zoom;
        const selected = artifact.id === selectedId;
        const lightness = dark ? (selected ? 32 : 22) : selected ? 82 : 92;
        context.fillStyle = `hsl(${String(artifact.hue)} 42% ${String(lightness)}%)`;
        context.strokeStyle = selected
          ? dark
            ? "#8eb0ff"
            : "#1e66f5"
          : dark
            ? `hsl(${String(artifact.hue)} 30% 38%)`
            : `hsl(${String(artifact.hue)} 30% 68%)`;
        context.lineWidth = selected ? 3 : 1;
        context.beginPath();
        context.roundRect(topLeft.x, topLeft.y, width, height, 6);
        context.fill();
        context.stroke();
        if (camera.zoom > 0.28) {
          context.fillStyle = dark ? "#e9eef7" : "#202630";
          context.font = `${String(Math.max(10, 13 * Math.min(camera.zoom, 1)))}px system-ui`;
          context.fillText(artifact.title, topLeft.x + 8, topLeft.y + 18, Math.max(width - 16, 8));
        }
      }

      const viewport = worldViewport(camera);
      setMetrics({
        zoom: camera.zoom,
        visible: sets.visible.length,
        overscan: sets.overscan.length,
        warm: sets.warm.length,
        cold: sets.cold.length,
        selected: selectedId ?? "—",
        drawMs: performance.now() - started,
      });
      canvas.dataset.viewport = `${viewport.x.toFixed(0)},${viewport.y.toFixed(0)}`;
    };

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
      const hit = store
        .queryPoint(world.x, world.y)
        .map((id) => artifacts.get(id))
        .filter((artifact) => artifact !== undefined)
        .sort((a, b) => b.frame.zIndex - a.frame.zIndex || b.id.localeCompare(a.id))[0];
      selectedId = hit?.id ?? null;
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
      themeObserver.disconnect();
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerup", pointerUp);
      canvas.removeEventListener("pointercancel", pointerCancel);
      canvas.removeEventListener("wheel", wheel);
    };
  }, []);

  return (
    <div className="demo-stage demo-stage--canvas">
      <canvas ref={canvasRef} className="demo-canvas" aria-label="Interactive infinite canvas" />
      <dl className="demo-hud" aria-live="polite">
        <div>
          <dt>zoom / LOD</dt>
          <dd>
            {metrics.zoom.toFixed(2)} / {selectLod(metrics.zoom)}
          </dd>
        </div>
        <div>
          <dt>visible / overscan</dt>
          <dd>
            {metrics.visible} / {metrics.overscan}
          </dd>
        </div>
        <div>
          <dt>warm / cold</dt>
          <dd>
            {metrics.warm} / {metrics.cold}
          </dd>
        </div>
        <div>
          <dt>draw / selected</dt>
          <dd>
            {metrics.drawMs.toFixed(2)} ms / {metrics.selected}
          </dd>
        </div>
      </dl>
    </div>
  );
}
