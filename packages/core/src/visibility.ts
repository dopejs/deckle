import type { ArtifactId, Rect } from "@dopejs/deckle-protocol";
import { inflateRect } from "@dopejs/deckle-spatial";
import { worldViewport, type Camera } from "./camera.js";
import type { SceneStore } from "./scene-store.js";

/**
 * Classified visibility sets (design §5.1). Sets are disjoint except `pinned`,
 * which overlays the others: a pinned artifact also appears in whichever
 * geometric set it belongs to.
 */
export interface VisibilitySets {
  readonly visible: readonly ArtifactId[];
  readonly overscan: readonly ArtifactId[];
  readonly warm: readonly ArtifactId[];
  readonly cold: readonly ArtifactId[];
  readonly pinned: readonly ArtifactId[];
}

export interface VisibilityOptions {
  /**
   * Overscan margin in world units added around the viewport, scaled along the
   * travel direction by `velocity` (world units per second) times `lookAheadSeconds`.
   */
  readonly overscanMargin: number;
  readonly lookAheadSeconds: number;
  readonly velocityX: number;
  readonly velocityY: number;
  /** Maximum number of artifacts retained warm; oldest-by-recency drop first. */
  readonly warmCapacity: number;
}

export const DEFAULT_VISIBILITY_OPTIONS: VisibilityOptions = {
  overscanMargin: 256,
  lookAheadSeconds: 0.5,
  velocityX: 0,
  velocityY: 0,
  warmCapacity: 64,
};

/**
 * Tracks recency so recently visible artifacts stay warm within budget.
 * Deterministic: recency is a monotonic step counter, not wall-clock time.
 */
export class VisibilityTracker {
  #recency = new Map<ArtifactId, number>();
  #step = 0;

  compute(
    store: SceneStore,
    camera: Camera,
    options: VisibilityOptions = DEFAULT_VISIBILITY_OPTIONS,
  ): VisibilitySets {
    if (options.warmCapacity < 0 || !Number.isInteger(options.warmCapacity)) {
      throw new RangeError(
        `warmCapacity must be a non-negative integer, got ${options.warmCapacity}`,
      );
    }
    this.#step += 1;
    const viewport = worldViewport(camera);
    const lead = options.lookAheadSeconds;
    const overscanRect = expandDirectional(
      inflateRect(viewport, options.overscanMargin),
      options.velocityX * lead,
      options.velocityY * lead,
    );

    const visibleIds = new Set(store.queryFrames(viewport));
    const overscanIds = new Set<ArtifactId>();
    for (const id of store.queryFrames(overscanRect)) {
      if (!visibleIds.has(id)) overscanIds.add(id);
    }

    for (const id of visibleIds) this.#recency.set(id, this.#step);
    for (const id of overscanIds) this.#recency.set(id, this.#step);

    const pinned: ArtifactId[] = [];
    const warmCandidates: { id: ArtifactId; recency: number }[] = [];
    const cold: ArtifactId[] = [];

    for (const record of store.records()) {
      if (record.pins.length > 0) pinned.push(record.id);
      if (visibleIds.has(record.id) || overscanIds.has(record.id)) continue;
      const recency = this.#recency.get(record.id);
      if (recency !== undefined) {
        warmCandidates.push({ id: record.id, recency });
      } else {
        cold.push(record.id);
      }
    }

    warmCandidates.sort((a, b) => b.recency - a.recency || compareIds(a.id, b.id));
    const warm = warmCandidates.slice(0, options.warmCapacity).map((entry) => entry.id);
    for (const entry of warmCandidates.slice(options.warmCapacity)) {
      this.#recency.delete(entry.id);
      cold.push(entry.id);
    }

    // Recency entries for removed artifacts must not leak.
    for (const id of this.#recency.keys()) {
      if (!store.getById(id)) this.#recency.delete(id);
    }

    return {
      visible: [...visibleIds],
      overscan: [...overscanIds],
      warm,
      cold,
      pinned,
    };
  }
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function expandDirectional(rect: Rect, dx: number, dy: number): Rect {
  return {
    x: rect.x + Math.min(0, dx),
    y: rect.y + Math.min(0, dy),
    width: rect.width + Math.abs(dx),
    height: rect.height + Math.abs(dy),
  };
}
