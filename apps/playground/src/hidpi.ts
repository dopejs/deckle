/**
 * Device-pixel-ratio aware canvas: the backing store is allocated at
 * `css × devicePixelRatio` and the context is pre-scaled, so story drawing
 * code works in CSS pixels while output stays sharp on HiDPI displays.
 */
export interface HiDpiCanvas {
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
  readonly cssWidth: number;
  readonly cssHeight: number;
  /** Reset the transform to the DPR scale and clear the full surface. */
  clear(): void;
}

export function createHiDpiCanvas(cssWidth: number, cssHeight: number): HiDpiCanvas {
  const dpr = Math.max(1, Math.min(4, globalThis.devicePixelRatio || 1));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas2D context unavailable");
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  return {
    canvas,
    context,
    cssWidth,
    cssHeight,
    clear() {
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, cssWidth, cssHeight);
    },
  };
}
