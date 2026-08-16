import type { PictureBackend, RetainedPicture } from "./picture.js";

/**
 * Byte-budgeted retained picture cache with pin-aware LRU eviction
 * (design §11). Admission is checked before allocation is published; an
 * artifact exceeding the per-item or global budget is rejected with a typed
 * reason rather than evicting the world to fit.
 */
export interface TextureCacheOptions {
  readonly maxTotalBytes: number;
  readonly maxItemBytes: number;
}

export type AdmissionResult =
  | { readonly admitted: true }
  | { readonly admitted: false; readonly reason: "item-over-budget" | "would-exceed-total" };

export interface TextureCacheStats {
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
  readonly admissionRejects: number;
  readonly totalBytes: number;
  readonly itemCount: number;
}

interface CacheEntry {
  readonly picture: RetainedPicture;
  recency: number;
}

export class TextureCache {
  readonly #options: TextureCacheOptions;
  readonly #backend: PictureBackend;
  readonly #entries = new Map<string, CacheEntry>();
  readonly #pinned = new Set<string>();
  #totalBytes = 0;
  #clock = 0;
  #hits = 0;
  #misses = 0;
  #evictions = 0;
  #admissionRejects = 0;

  constructor(backend: PictureBackend, options: TextureCacheOptions) {
    if (!Number.isFinite(options.maxTotalBytes) || options.maxTotalBytes < 0) {
      throw new RangeError(`maxTotalBytes must be non-negative, got ${options.maxTotalBytes}`);
    }
    if (!Number.isFinite(options.maxItemBytes) || options.maxItemBytes < 0) {
      throw new RangeError(`maxItemBytes must be non-negative, got ${options.maxItemBytes}`);
    }
    this.#backend = backend;
    this.#options = options;
  }

  /**
   * Admit-and-store a new picture for an artifact, replacing any prior one.
   * Eviction of unpinned LRU entries runs first; if the budget still cannot
   * fit the item (because remaining entries are pinned), admission fails and
   * nothing is allocated.
   */
  put(init: RetainedPicture): AdmissionResult {
    if (init.byteEstimate > this.#options.maxItemBytes) {
      this.#admissionRejects += 1;
      return { admitted: false, reason: "item-over-budget" };
    }

    const existing = this.#entries.get(init.artifactId);
    const existingBytes = existing ? existing.picture.byteEstimate : 0;
    const projected = () => this.#totalBytes - existingBytes + init.byteEstimate;

    while (projected() > this.#options.maxTotalBytes) {
      if (!this.#evictOneUnpinned(init.artifactId)) {
        this.#admissionRejects += 1;
        return { admitted: false, reason: "would-exceed-total" };
      }
    }

    const picture = this.#backend.createPicture(init);
    if (existing) {
      this.#backend.releasePicture(existing.picture);
      this.#totalBytes -= existingBytes;
      this.#entries.delete(init.artifactId);
    }
    this.#entries.set(init.artifactId, { picture, recency: this.#clock++ });
    this.#totalBytes += picture.byteEstimate;
    return { admitted: true };
  }

  /** Current picture for an artifact; refreshes recency on hit. */
  get(artifactId: string): RetainedPicture | undefined {
    const entry = this.#entries.get(artifactId);
    if (!entry) {
      this.#misses += 1;
      return undefined;
    }
    entry.recency = this.#clock++;
    this.#hits += 1;
    return entry.picture;
  }

  /** Fetch without recency/statistics side effects (devtools, tests). */
  peek(artifactId: string): RetainedPicture | undefined {
    return this.#entries.get(artifactId)?.picture;
  }

  delete(artifactId: string): boolean {
    const entry = this.#entries.get(artifactId);
    if (!entry) return false;
    this.#backend.releasePicture(entry.picture);
    this.#totalBytes -= entry.picture.byteEstimate;
    this.#entries.delete(artifactId);
    this.#pinned.delete(artifactId);
    return true;
  }

  pin(artifactId: string): void {
    this.#pinned.add(artifactId);
  }

  unpin(artifactId: string): void {
    this.#pinned.delete(artifactId);
  }

  isPinned(artifactId: string): boolean {
    return this.#pinned.has(artifactId);
  }

  stats(): TextureCacheStats {
    return {
      hits: this.#hits,
      misses: this.#misses,
      evictions: this.#evictions,
      admissionRejects: this.#admissionRejects,
      totalBytes: this.#totalBytes,
      itemCount: this.#entries.size,
    };
  }

  clear(): void {
    for (const entry of this.#entries.values()) {
      this.#backend.releasePicture(entry.picture);
    }
    this.#entries.clear();
    this.#pinned.clear();
    this.#totalBytes = 0;
  }

  #evictOneUnpinned(excludeArtifactId: string): boolean {
    let victim: string | null = null;
    let victimRecency = Number.POSITIVE_INFINITY;
    for (const [artifactId, entry] of this.#entries) {
      if (artifactId === excludeArtifactId) continue;
      if (this.#pinned.has(artifactId)) continue;
      if (entry.recency < victimRecency) {
        victim = artifactId;
        victimRecency = entry.recency;
      }
    }
    if (victim === null) return false;
    this.delete(victim);
    this.#evictions += 1;
    return true;
  }
}
