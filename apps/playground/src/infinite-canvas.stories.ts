import {
  createCamera,
  panCamera,
  screenToWorld,
  worldToScreen,
  worldViewport,
  VisibilityTracker,
  zoomCameraAt,
  type Camera,
} from "@dopejs/canvas-core";
import { selectLod } from "@dopejs/canvas-renderer";
import { artifactFillStyle, artifactStrokeStyle, buildDemoScene } from "./scene-demo.js";

export default {
  title: "Infinite Canvas",
};

/**
 * 500 logical artifacts in seeded clusters. Drag to pan, wheel to zoom at the
 * cursor, click to select. The HUD shows visibility sets, the active LOD
 * band, and frame time — camera-only movement never rebuilds content.
 */
export const Pan_Zoom_Select = (): HTMLElement => {
  const root = document.createElement("div");
  root.style.cssText = "font: 12px system-ui; position: relative;";

  const canvas = document.createElement("canvas");
  canvas.width = 960;
  canvas.height = 600;
  canvas.style.cssText = "border: 1px solid #ccc; border-radius: 6px; cursor: grab;";
  const hud = document.createElement("div");
  hud.style.cssText =
    "position: absolute; top: 8px; left: 8px; background: rgba(255,255,255,.9); " +
    "padding: 6px 10px; border-radius: 6px; box-shadow: 0 1px 4px rgba(0,0,0,.2); white-space: pre;";
  root.append(canvas, hud);

  const { store, artifacts } = buildDemoScene(2026, 500);
  const tracker = new VisibilityTracker();
  // Start centered on the first cluster so the first frame shows content.
  const anchor = artifacts.get("artifact-0") as { frame: { x: number; y: number } };
  let camera: Camera = createCamera({
    x: anchor.frame.x,
    y: anchor.frame.y,
    zoom: 0.35,
    viewportWidth: canvas.width,
    viewportHeight: canvas.height,
  });
  let selectedId: string | null = null;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas2D context unavailable");

  const draw = (): void => {
    const start = performance.now();
    const sets = tracker.compute(store, camera);
    context.clearRect(0, 0, canvas.width, canvas.height);

    const drawable = [...sets.visible]
      .map((id) => artifacts.get(id))
      .filter((artifact) => artifact !== undefined)
      .sort((a, b) => a.frame.zIndex - b.frame.zIndex || (a.id < b.id ? -1 : 1));

    for (const artifact of drawable) {
      const topLeft = worldToScreen(camera, { x: artifact.frame.x, y: artifact.frame.y });
      const width = artifact.frame.width * camera.zoom;
      const height = artifact.frame.height * camera.zoom;
      const selected = artifact.id === selectedId;
      context.fillStyle = artifactFillStyle(artifact.hue, selected);
      context.strokeStyle = artifactStrokeStyle(artifact.hue, selected);
      context.lineWidth = selected ? 3 : 1;
      context.beginPath();
      context.roundRect(topLeft.x, topLeft.y, width, height, 6 * Math.min(camera.zoom, 1));
      context.fill();
      context.stroke();
      if (camera.zoom > 0.25) {
        context.fillStyle = "#1a1a1a";
        context.font = `${Math.max(10, 13 * Math.min(camera.zoom, 1))}px system-ui`;
        context.fillText(artifact.title, topLeft.x + 8, topLeft.y + 18, Math.max(width - 16, 8));
      }
    }

    const frameMs = performance.now() - start;
    const viewport = worldViewport(camera);
    hud.textContent =
      `zoom ${camera.zoom.toFixed(2)}  lod ${selectLod(camera.zoom)}\n` +
      `visible ${sets.visible.length}  overscan ${sets.overscan.length}  ` +
      `warm ${sets.warm.length}  cold ${sets.cold.length}\n` +
      `viewport x ${viewport.x.toFixed(0)} y ${viewport.y.toFixed(0)}\n` +
      `draw ${frameMs.toFixed(2)} ms  selected ${selectedId ?? "none"}`;
  };

  let dragging = false;
  let moved = false;
  let lastX = 0;
  let lastY = 0;
  canvas.addEventListener("pointerdown", (event) => {
    dragging = true;
    moved = false;
    lastX = event.offsetX;
    lastY = event.offsetY;
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = "grabbing";
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const dx = event.offsetX - lastX;
    const dy = event.offsetY - lastY;
    if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
    camera = panCamera(camera, -dx, -dy);
    lastX = event.offsetX;
    lastY = event.offsetY;
    draw();
  });
  canvas.addEventListener("pointerup", (event) => {
    dragging = false;
    canvas.style.cursor = "grab";
    if (moved) return;
    const world = screenToWorld(camera, { x: event.offsetX, y: event.offsetY });
    const hits = store.queryPoint(world.x, world.y);
    // Topmost by zIndex, ties broken by id, matching draw order.
    const top = hits
      .map((id) => artifacts.get(id))
      .filter((artifact) => artifact !== undefined)
      .sort((a, b) => b.frame.zIndex - a.frame.zIndex || (a.id < b.id ? 1 : -1))[0];
    selectedId = top ? top.id : null;
    draw();
  });
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      camera = zoomCameraAt(camera, { x: event.offsetX, y: event.offsetY }, factor);
      draw();
    },
    { passive: false },
  );

  draw();
  return root;
};
