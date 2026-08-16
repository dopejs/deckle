import {
  panCamera,
  resizeCameraViewport,
  zoomCameraAt,
  type Camera,
  type CameraLimits,
  DEFAULT_CAMERA_LIMITS,
} from "./camera.js";

/**
 * Deterministic input trace (plan §5). Camera interaction is recorded as a
 * value sequence that replays to an identical camera on any machine, which
 * makes benchmark traces and bug reproductions exact.
 */
export type CameraInputEvent =
  | { readonly kind: "pan"; readonly dx: number; readonly dy: number }
  | {
      readonly kind: "zoom";
      readonly anchorX: number;
      readonly anchorY: number;
      readonly factor: number;
    }
  | { readonly kind: "resize"; readonly width: number; readonly height: number };

export const INPUT_TRACE_FORMAT_VERSION = 1 as const;

export interface InputTrace {
  readonly formatVersion: typeof INPUT_TRACE_FORMAT_VERSION;
  readonly initialCamera: Camera;
  readonly events: readonly CameraInputEvent[];
}

export function applyCameraInput(
  camera: Camera,
  event: CameraInputEvent,
  limits: CameraLimits = DEFAULT_CAMERA_LIMITS,
): Camera {
  switch (event.kind) {
    case "pan":
      return panCamera(camera, event.dx, event.dy);
    case "zoom":
      return zoomCameraAt(camera, { x: event.anchorX, y: event.anchorY }, event.factor, limits);
    case "resize":
      return resizeCameraViewport(camera, event.width, event.height);
  }
}

export function replayInputTrace(trace: InputTrace, limits?: CameraLimits): Camera {
  // Traces may arrive from persisted JSON; do not trust the static type.
  const formatVersion: unknown = trace.formatVersion;
  if (formatVersion !== INPUT_TRACE_FORMAT_VERSION) {
    throw new RangeError(`Unsupported input trace format version ${String(formatVersion)}`);
  }
  let camera = trace.initialCamera;
  for (const event of trace.events) {
    camera = applyCameraInput(camera, event, limits);
  }
  return camera;
}

export class InputTraceRecorder {
  #camera: Camera;
  readonly #initialCamera: Camera;
  readonly #events: CameraInputEvent[] = [];
  readonly #limits: CameraLimits;

  constructor(initialCamera: Camera, limits: CameraLimits = DEFAULT_CAMERA_LIMITS) {
    this.#camera = initialCamera;
    this.#initialCamera = initialCamera;
    this.#limits = limits;
  }

  get camera(): Camera {
    return this.#camera;
  }

  apply(event: CameraInputEvent): Camera {
    this.#camera = applyCameraInput(this.#camera, event, this.#limits);
    this.#events.push(event);
    return this.#camera;
  }

  trace(): InputTrace {
    return {
      formatVersion: INPUT_TRACE_FORMAT_VERSION,
      initialCamera: this.#initialCamera,
      events: [...this.#events],
    };
  }
}
