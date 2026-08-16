/**
 * Backend-neutral retained picture contract (design §11, plan §5). A picture
 * is one immutable paint result for a (sourceRevision, stateRevision) pair;
 * backends own the pixels, the host owns identity and lifetime accounting.
 */
export interface RetainedPicture {
  readonly artifactId: string;
  readonly paintRevision: number;
  readonly widthPx: number;
  readonly heightPx: number;
  /** Resolution relative to CSS pixels; 0.5 = half-resolution snapshot. */
  readonly resolutionScale: number;
  readonly byteEstimate: number;
}

export interface PictureBackend {
  /** Allocate a picture; throws if the backend cannot allocate. */
  createPicture(init: RetainedPicture): RetainedPicture;
  /** Release backend resources. Releasing twice is an error (double free). */
  releasePicture(picture: RetainedPicture): void;
  /** Number of live pictures, for leak detection in tests and devtools. */
  readonly livePictureCount: number;
}

export class PictureLifetimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PictureLifetimeError";
  }
}

/**
 * Headless reference backend: validates the contract and tracks lifetimes so
 * soak tests can assert zero leaks. Real backends (Canvas2D/WebGL/PixiJS)
 * implement the same interface behind an adapter.
 */
export class ReferencePictureBackend implements PictureBackend {
  readonly #live = new Set<RetainedPicture>();
  #totalCreated = 0;

  createPicture(init: RetainedPicture): RetainedPicture {
    if (
      !Number.isFinite(init.widthPx) ||
      !Number.isFinite(init.heightPx) ||
      init.widthPx < 0 ||
      init.heightPx < 0 ||
      !Number.isFinite(init.resolutionScale) ||
      init.resolutionScale <= 0 ||
      !Number.isFinite(init.byteEstimate) ||
      init.byteEstimate < 0
    ) {
      throw new PictureLifetimeError(
        `invalid picture dimensions for artifact "${init.artifactId}"`,
      );
    }
    const picture: RetainedPicture = { ...init };
    this.#live.add(picture);
    this.#totalCreated += 1;
    return picture;
  }

  releasePicture(picture: RetainedPicture): void {
    if (!this.#live.delete(picture)) {
      throw new PictureLifetimeError(
        `double release of picture for artifact "${picture.artifactId}" rev ${picture.paintRevision}`,
      );
    }
  }

  get livePictureCount(): number {
    return this.#live.size;
  }

  get totalCreated(): number {
    return this.#totalCreated;
  }
}
