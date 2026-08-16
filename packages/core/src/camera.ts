import type { Rect } from "@dopejs/canvas-protocol";

/**
 * Camera over logical world coordinates. `x`/`y` is the world point at the
 * viewport center; `zoom` is screen pixels per world unit.
 */
export interface Camera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
}

export interface CameraLimits {
  readonly minZoom: number;
  readonly maxZoom: number;
}

export const DEFAULT_CAMERA_LIMITS: CameraLimits = {
  minZoom: 1e-6,
  maxZoom: 1e4,
};

export class InvalidCameraError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCameraError";
  }
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new InvalidCameraError(`${label} must be finite, got ${value}`);
  }
}

export function createCamera(
  partial: Partial<Camera> = {},
  limits = DEFAULT_CAMERA_LIMITS,
): Camera {
  const camera: Camera = {
    x: partial.x ?? 0,
    y: partial.y ?? 0,
    zoom: partial.zoom ?? 1,
    viewportWidth: partial.viewportWidth ?? 0,
    viewportHeight: partial.viewportHeight ?? 0,
  };
  assertFinite(camera.x, "camera.x");
  assertFinite(camera.y, "camera.y");
  assertFinite(camera.zoom, "camera.zoom");
  assertFinite(camera.viewportWidth, "camera.viewportWidth");
  assertFinite(camera.viewportHeight, "camera.viewportHeight");
  if (camera.zoom <= 0) throw new InvalidCameraError(`camera.zoom must be > 0, got ${camera.zoom}`);
  if (camera.viewportWidth < 0 || camera.viewportHeight < 0) {
    throw new InvalidCameraError("viewport dimensions must be >= 0");
  }
  if (camera.zoom < limits.minZoom || camera.zoom > limits.maxZoom) {
    throw new InvalidCameraError(
      `camera.zoom ${camera.zoom} outside limits [${limits.minZoom}, ${limits.maxZoom}]`,
    );
  }
  return camera;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export function screenToWorld(camera: Camera, screen: Point): Point {
  return {
    x: camera.x + (screen.x - camera.viewportWidth / 2) / camera.zoom,
    y: camera.y + (screen.y - camera.viewportHeight / 2) / camera.zoom,
  };
}

export function worldToScreen(camera: Camera, world: Point): Point {
  return {
    x: (world.x - camera.x) * camera.zoom + camera.viewportWidth / 2,
    y: (world.y - camera.y) * camera.zoom + camera.viewportHeight / 2,
  };
}

/** World-space rect currently covered by the viewport. */
export function worldViewport(camera: Camera): Rect {
  const width = camera.viewportWidth / camera.zoom;
  const height = camera.viewportHeight / camera.zoom;
  return { x: camera.x - width / 2, y: camera.y - height / 2, width, height };
}

/** Pan by a screen-space delta (positive dx moves content left / camera right). */
export function panCamera(camera: Camera, screenDx: number, screenDy: number): Camera {
  assertFinite(screenDx, "screenDx");
  assertFinite(screenDy, "screenDy");
  return createCamera({
    ...camera,
    x: camera.x + screenDx / camera.zoom,
    y: camera.y + screenDy / camera.zoom,
  });
}

/**
 * Zoom by `factor`, keeping the world point under `screenAnchor` stationary on
 * screen. Zoom is clamped to limits; the anchor invariant holds at the clamped
 * zoom as well.
 */
export function zoomCameraAt(
  camera: Camera,
  screenAnchor: Point,
  factor: number,
  limits = DEFAULT_CAMERA_LIMITS,
): Camera {
  assertFinite(factor, "factor");
  if (factor <= 0) throw new InvalidCameraError(`zoom factor must be > 0, got ${factor}`);
  const nextZoom = Math.min(limits.maxZoom, Math.max(limits.minZoom, camera.zoom * factor));
  const anchorWorld = screenToWorld(camera, screenAnchor);
  return createCamera(
    {
      ...camera,
      zoom: nextZoom,
      x: anchorWorld.x - (screenAnchor.x - camera.viewportWidth / 2) / nextZoom,
      y: anchorWorld.y - (screenAnchor.y - camera.viewportHeight / 2) / nextZoom,
    },
    limits,
  );
}

export function resizeCameraViewport(camera: Camera, width: number, height: number): Camera {
  return createCamera({ ...camera, viewportWidth: width, viewportHeight: height });
}

/**
 * Renderer origin rebasing. When the camera center drifts beyond `threshold`
 * world units from the current render origin, the origin snaps to a multiple of
 * `granularity` near the camera. Render coordinates are `world - origin`, which
 * keeps transform and text coordinates small at extreme world positions.
 * Rebasing changes rendering coordinates only, never logical positions.
 */
export interface RenderOrigin {
  readonly x: number;
  readonly y: number;
}

export interface RebaseOptions {
  readonly threshold: number;
  readonly granularity: number;
}

export const DEFAULT_REBASE_OPTIONS: RebaseOptions = {
  threshold: 1 << 20,
  granularity: 1 << 16,
};

export function maybeRebaseOrigin(
  origin: RenderOrigin,
  camera: Camera,
  options: RebaseOptions = DEFAULT_REBASE_OPTIONS,
): RenderOrigin {
  if (!Number.isFinite(options.threshold) || options.threshold <= 0) {
    throw new RangeError(`rebase threshold must be positive, got ${options.threshold}`);
  }
  if (!Number.isFinite(options.granularity) || options.granularity <= 0) {
    throw new RangeError(`rebase granularity must be positive, got ${options.granularity}`);
  }
  const dx = camera.x - origin.x;
  const dy = camera.y - origin.y;
  if (Math.abs(dx) <= options.threshold && Math.abs(dy) <= options.threshold) {
    return origin;
  }
  return {
    x: Math.round(camera.x / options.granularity) * options.granularity,
    y: Math.round(camera.y / options.granularity) * options.granularity,
  };
}

export function worldToRender(origin: RenderOrigin, world: Point): Point {
  return { x: world.x - origin.x, y: world.y - origin.y };
}
