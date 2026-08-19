import type { Rect } from "@dopejs/deckle-protocol";
import { isValidRect, rectContainsPoint, rectsIntersect } from "./rect.js";
import { InvalidRectError, type SpatialIndex } from "./types.js";

/**
 * Linear-scan reference implementation. It is the differential oracle for every
 * optimized index and stays available at runtime as a rollback path.
 */
export class NaiveSpatialIndex implements SpatialIndex {
  readonly #rects = new Map<string, Rect>();

  set(id: string, rect: Rect): void {
    if (!isValidRect(rect)) throw new InvalidRectError(id, rect);
    this.#rects.set(id, { ...rect });
  }

  delete(id: string): boolean {
    return this.#rects.delete(id);
  }

  get(id: string): Rect | undefined {
    const rect = this.#rects.get(id);
    return rect ? { ...rect } : undefined;
  }

  queryRect(rect: Rect): string[] {
    if (!isValidRect(rect)) throw new InvalidRectError("<query>", rect);
    const hits: string[] = [];
    for (const [id, candidate] of this.#rects) {
      if (rectsIntersect(candidate, rect)) hits.push(id);
    }
    return hits;
  }

  queryPoint(x: number, y: number): string[] {
    const hits: string[] = [];
    for (const [id, candidate] of this.#rects) {
      if (rectContainsPoint(candidate, x, y)) hits.push(id);
    }
    return hits;
  }

  get size(): number {
    return this.#rects.size;
  }

  clear(): void {
    this.#rects.clear();
  }
}
