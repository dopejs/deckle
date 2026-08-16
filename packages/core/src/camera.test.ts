import { createSeededRandom } from "@dopejs/canvas-spatial";
import { describe, expect, it } from "vitest";
import {
  createCamera,
  DEFAULT_REBASE_OPTIONS,
  InvalidCameraError,
  maybeRebaseOrigin,
  panCamera,
  screenToWorld,
  worldToRender,
  worldToScreen,
  worldViewport,
  zoomCameraAt,
} from "./index.js";

describe("camera transforms", () => {
  const camera = createCamera({ x: 100, y: -50, zoom: 2, viewportWidth: 800, viewportHeight: 600 });

  it("should map the viewport center to the camera position", () => {
    expect(screenToWorld(camera, { x: 400, y: 300 })).toEqual({ x: 100, y: -50 });
    expect(worldToScreen(camera, { x: 100, y: -50 })).toEqual({ x: 400, y: 300 });
  });

  it("should round-trip screen and world coordinates within float tolerance", () => {
    const random = createSeededRandom(42);
    for (let i = 0; i < 200; i += 1) {
      const zoom = 10 ** ((random() - 0.5) * 6);
      const testCamera = createCamera({
        x: (random() - 0.5) * 1e6,
        y: (random() - 0.5) * 1e6,
        zoom,
        viewportWidth: 1920,
        viewportHeight: 1080,
      });
      const screen = { x: random() * 1920, y: random() * 1080 };
      const back = worldToScreen(testCamera, screenToWorld(testCamera, screen));
      expect(back.x).toBeCloseTo(screen.x, 4);
      expect(back.y).toBeCloseTo(screen.y, 4);
    }
  });

  it("should compute the world viewport centered on the camera", () => {
    expect(worldViewport(camera)).toEqual({ x: -100, y: -200, width: 400, height: 300 });
  });

  it("should pan by screen deltas scaled by zoom", () => {
    const panned = panCamera(camera, 100, -50);
    expect(panned.x).toBe(150);
    expect(panned.y).toBe(-75);
  });

  it("should keep the anchor world point stationary while zooming", () => {
    const random = createSeededRandom(7);
    for (let i = 0; i < 200; i += 1) {
      const testCamera = createCamera({
        x: (random() - 0.5) * 1e4,
        y: (random() - 0.5) * 1e4,
        zoom: 10 ** ((random() - 0.5) * 4),
        viewportWidth: 1280,
        viewportHeight: 720,
      });
      const anchor = { x: random() * 1280, y: random() * 720 };
      const before = screenToWorld(testCamera, anchor);
      const zoomed = zoomCameraAt(testCamera, anchor, 0.25 + random() * 4);
      const after = screenToWorld(zoomed, anchor);
      expect(after.x).toBeCloseTo(before.x, 6);
      expect(after.y).toBeCloseTo(before.y, 6);
    }
  });

  it("should clamp zoom to limits while preserving the anchor", () => {
    const limits = { minZoom: 0.5, maxZoom: 4 };
    const base = createCamera(
      { x: 0, y: 0, zoom: 2, viewportWidth: 100, viewportHeight: 100 },
      limits,
    );
    const anchor = { x: 25, y: 25 };
    const before = screenToWorld(base, anchor);
    const zoomed = zoomCameraAt(base, anchor, 100, limits);
    expect(zoomed.zoom).toBe(4);
    expect(screenToWorld(zoomed, anchor)).toEqual(before);
  });

  it("should reject invalid camera values", () => {
    expect(() => createCamera({ zoom: 0 })).toThrow(InvalidCameraError);
    expect(() => createCamera({ zoom: -1 })).toThrow(InvalidCameraError);
    expect(() => createCamera({ x: Number.NaN })).toThrow(InvalidCameraError);
    expect(() => createCamera({ viewportWidth: -1 })).toThrow(InvalidCameraError);
    expect(() => zoomCameraAt(camera, { x: 0, y: 0 }, 0)).toThrow(InvalidCameraError);
  });
});

describe("origin rebasing", () => {
  it("should keep the origin stable inside the threshold", () => {
    const origin = { x: 0, y: 0 };
    const camera = createCamera({
      x: 1000,
      y: 1000,
      zoom: 1,
      viewportWidth: 100,
      viewportHeight: 100,
    });
    expect(maybeRebaseOrigin(origin, camera)).toBe(origin);
  });

  it("should snap the origin to granularity beyond the threshold", () => {
    const camera = createCamera({
      x: 5e9,
      y: -3e9,
      zoom: 1,
      viewportWidth: 100,
      viewportHeight: 100,
    });
    const origin = maybeRebaseOrigin({ x: 0, y: 0 }, camera);
    const g = DEFAULT_REBASE_OPTIONS.granularity;
    expect(Math.abs(origin.x % g)).toBe(0);
    expect(Math.abs(origin.y % g)).toBe(0);
    expect(Math.abs(origin.x - camera.x)).toBeLessThanOrEqual(g / 2);
    expect(Math.abs(origin.y - camera.y)).toBeLessThanOrEqual(g / 2);
  });

  it("should keep render coordinates small at extreme world positions", () => {
    const world = { x: 1e12 + 0.5, y: -1e12 + 0.25 };
    const camera = createCamera({
      x: 1e12,
      y: -1e12,
      zoom: 1,
      viewportWidth: 100,
      viewportHeight: 100,
    });
    const origin = maybeRebaseOrigin({ x: 0, y: 0 }, camera);
    const render = worldToRender(origin, world);
    expect(Math.abs(render.x)).toBeLessThan(DEFAULT_REBASE_OPTIONS.granularity);
    expect(Math.abs(render.y)).toBeLessThan(DEFAULT_REBASE_OPTIONS.granularity);
  });

  it("should reject non-positive rebase options", () => {
    const camera = createCamera({ viewportWidth: 10, viewportHeight: 10 });
    expect(() =>
      maybeRebaseOrigin({ x: 0, y: 0 }, camera, { threshold: 0, granularity: 1 }),
    ).toThrow(RangeError);
    expect(() =>
      maybeRebaseOrigin({ x: 0, y: 0 }, camera, { threshold: 1, granularity: 0 }),
    ).toThrow(RangeError);
  });
});
