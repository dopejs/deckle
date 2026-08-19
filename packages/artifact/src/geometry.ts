import type { Rect } from "@dopejs/deckle-protocol";

/**
 * Row-major 2D affine transform:
 * `[ a c e ]`
 * `[ b d f ]`
 * matching the CSS/Canvas2D matrix parameter order.
 */
export interface Mat2D {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

export const IDENTITY_MATRIX: Mat2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export function isValidMatrix(m: Mat2D): boolean {
  return (
    Number.isFinite(m.a) &&
    Number.isFinite(m.b) &&
    Number.isFinite(m.c) &&
    Number.isFinite(m.d) &&
    Number.isFinite(m.e) &&
    Number.isFinite(m.f)
  );
}

export function matrixMultiply(left: Mat2D, right: Mat2D): Mat2D {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

export class SingularMatrixError extends Error {
  constructor() {
    super("Matrix is singular and cannot be inverted");
    this.name = "SingularMatrixError";
  }
}

export function matrixInvert(m: Mat2D): Mat2D {
  const det = m.a * m.d - m.b * m.c;
  if (det === 0 || !Number.isFinite(det)) throw new SingularMatrixError();
  const inverseDet = 1 / det;
  return {
    a: m.d * inverseDet,
    b: -m.b * inverseDet,
    c: -m.c * inverseDet,
    d: m.a * inverseDet,
    e: (m.c * m.f - m.d * m.e) * inverseDet,
    f: (m.b * m.e - m.a * m.f) * inverseDet,
  };
}

export function matrixApply(m: Mat2D, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

export function matrixTranslate(tx: number, ty: number): Mat2D {
  return { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty };
}

export function matrixScale(sx: number, sy: number): Mat2D {
  return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
}

export function matrixRotate(radians: number): Mat2D {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

/** Axis-aligned bounding box of a rect under an affine transform. */
export function transformRectBounds(m: Mat2D, rect: Rect): Rect {
  const corners = [
    matrixApply(m, rect.x, rect.y),
    matrixApply(m, rect.x + rect.width, rect.y),
    matrixApply(m, rect.x, rect.y + rect.height),
    matrixApply(m, rect.x + rect.width, rect.y + rect.height),
  ];
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}
