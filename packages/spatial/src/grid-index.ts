import type { Rect } from "@dopejs/deckle-protocol";
import { isValidRect, rectContainsPoint, rectsIntersect } from "./rect.js";
import { InvalidRectError, type SpatialIndex } from "./types.js";

export interface GridSpatialIndexOptions {
  /** World units per grid cell. Must be a positive finite number. */
  readonly cellSize?: number;
  /**
   * Entries covering more cells than this are kept in a linearly scanned
   * oversize set instead of being fanned out across the grid. Bounds worst-case
   * insertion cost for giant frames without losing correctness.
   */
  readonly maxCellsPerEntry?: number;
}

interface GridEntry {
  readonly rect: Rect;
  /** Cell keys the entry occupies, or null when tracked in the oversize set. */
  readonly cells: readonly string[] | null;
}

const DEFAULT_CELL_SIZE = 512;
const DEFAULT_MAX_CELLS_PER_ENTRY = 256;

/**
 * Uniform hash-grid index. Insert/delete are O(cells covered); queries touch
 * only the cells overlapping the query rect plus the bounded oversize set.
 * Differentially tested against {@link NaiveSpatialIndex}.
 */
export class GridSpatialIndex implements SpatialIndex {
  readonly #cellSize: number;
  readonly #maxCellsPerEntry: number;
  readonly #entries = new Map<string, GridEntry>();
  readonly #cells = new Map<string, Set<string>>();
  readonly #oversized = new Set<string>();

  constructor(options: GridSpatialIndexOptions = {}) {
    const cellSize = options.cellSize ?? DEFAULT_CELL_SIZE;
    const maxCells = options.maxCellsPerEntry ?? DEFAULT_MAX_CELLS_PER_ENTRY;
    if (!Number.isFinite(cellSize) || cellSize <= 0) {
      throw new RangeError(`cellSize must be a positive finite number, got ${cellSize}`);
    }
    if (!Number.isInteger(maxCells) || maxCells < 1) {
      throw new RangeError(`maxCellsPerEntry must be a positive integer, got ${maxCells}`);
    }
    this.#cellSize = cellSize;
    this.#maxCellsPerEntry = maxCells;
  }

  set(id: string, rect: Rect): void {
    if (!isValidRect(rect)) throw new InvalidRectError(id, rect);
    this.delete(id);

    const copy: Rect = { ...rect };
    const minCol = Math.floor(copy.x / this.#cellSize);
    const maxCol = Math.floor((copy.x + copy.width) / this.#cellSize);
    const minRow = Math.floor(copy.y / this.#cellSize);
    const maxRow = Math.floor((copy.y + copy.height) / this.#cellSize);
    const cellCount = (maxCol - minCol + 1) * (maxRow - minRow + 1);

    if (cellCount > this.#maxCellsPerEntry) {
      this.#oversized.add(id);
      this.#entries.set(id, { rect: copy, cells: null });
      return;
    }

    const cells: string[] = [];
    for (let col = minCol; col <= maxCol; col += 1) {
      for (let row = minRow; row <= maxRow; row += 1) {
        const key = `${col}:${row}`;
        cells.push(key);
        let bucket = this.#cells.get(key);
        if (!bucket) {
          bucket = new Set();
          this.#cells.set(key, bucket);
        }
        bucket.add(id);
      }
    }
    this.#entries.set(id, { rect: copy, cells });
  }

  delete(id: string): boolean {
    const entry = this.#entries.get(id);
    if (!entry) return false;
    if (entry.cells === null) {
      this.#oversized.delete(id);
    } else {
      for (const key of entry.cells) {
        const bucket = this.#cells.get(key);
        if (bucket) {
          bucket.delete(id);
          if (bucket.size === 0) this.#cells.delete(key);
        }
      }
    }
    this.#entries.delete(id);
    return true;
  }

  get(id: string): Rect | undefined {
    const entry = this.#entries.get(id);
    return entry ? { ...entry.rect } : undefined;
  }

  queryRect(rect: Rect): string[] {
    if (!isValidRect(rect)) throw new InvalidRectError("<query>", rect);
    const hits: string[] = [];
    const seen = new Set<string>();

    const minCol = Math.floor(rect.x / this.#cellSize);
    const maxCol = Math.floor((rect.x + rect.width) / this.#cellSize);
    const minRow = Math.floor(rect.y / this.#cellSize);
    const maxRow = Math.floor((rect.y + rect.height) / this.#cellSize);
    // A query spanning more cells than any entry may occupy degrades to an
    // entry scan instead of iterating an unbounded cell range.
    const cellCount = (maxCol - minCol + 1) * (maxRow - minRow + 1);
    if (cellCount > this.#entries.size + this.#maxCellsPerEntry) {
      for (const [id, entry] of this.#entries) {
        if (rectsIntersect(entry.rect, rect)) hits.push(id);
      }
      return hits;
    }

    for (let col = minCol; col <= maxCol; col += 1) {
      for (let row = minRow; row <= maxRow; row += 1) {
        const bucket = this.#cells.get(`${col}:${row}`);
        if (!bucket) continue;
        for (const id of bucket) {
          if (seen.has(id)) continue;
          seen.add(id);
          const entry = this.#entries.get(id);
          if (entry && rectsIntersect(entry.rect, rect)) hits.push(id);
        }
      }
    }
    for (const id of this.#oversized) {
      const entry = this.#entries.get(id);
      if (entry && rectsIntersect(entry.rect, rect)) hits.push(id);
    }
    return hits;
  }

  queryPoint(x: number, y: number): string[] {
    const hits: string[] = [];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return hits;
    const bucket = this.#cells.get(
      `${Math.floor(x / this.#cellSize)}:${Math.floor(y / this.#cellSize)}`,
    );
    if (bucket) {
      for (const id of bucket) {
        const entry = this.#entries.get(id);
        if (entry && rectContainsPoint(entry.rect, x, y)) hits.push(id);
      }
    }
    for (const id of this.#oversized) {
      const entry = this.#entries.get(id);
      if (entry && rectContainsPoint(entry.rect, x, y)) hits.push(id);
    }
    return hits;
  }

  get size(): number {
    return this.#entries.size;
  }

  clear(): void {
    this.#entries.clear();
    this.#cells.clear();
    this.#oversized.clear();
  }
}
