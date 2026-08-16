import type { Rect } from "@dopejs/canvas-protocol";

/**
 * Backend-neutral spatial index contract. Keys are opaque strings owned by the
 * caller (Scene Store artifact ids in practice). Implementations must return
 * query results as a set with no duplicates; ordering is unspecified and the
 * caller applies paint-order or z sorting.
 */
export interface SpatialIndex {
  /** Insert a new entry or replace the rect of an existing one. */
  set(id: string, rect: Rect): void;
  /** Remove an entry; removing an unknown id is a no-op returning false. */
  delete(id: string): boolean;
  /** Rect for an id, or undefined when absent. */
  get(id: string): Rect | undefined;
  /** Ids whose rects intersect the query rect (closed intervals). */
  queryRect(rect: Rect): string[];
  /** Ids whose rects contain the point (closed intervals). */
  queryPoint(x: number, y: number): string[];
  readonly size: number;
  clear(): void;
}

export class InvalidRectError extends Error {
  constructor(id: string, rect: Rect) {
    super(
      `Rect for "${id}" must have finite components and non-negative extent, got ` +
        `x=${rect.x} y=${rect.y} width=${rect.width} height=${rect.height}`,
    );
    this.name = "InvalidRectError";
  }
}
