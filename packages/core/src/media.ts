import type { ArtifactKind, MediaMetadata } from "@dopejs/deckle-protocol";
import type { ArtifactHandle, SceneStore } from "./scene-store.js";

/**
 * Ingestion for atomic media. An image or a video has no partial content: no
 * prefix of the bytes is a smaller picture, so there is nothing to segment and
 * nothing provisional to paint. It is loading, then ready, or it failed.
 *
 * Decoding is the host's job — the engine stays free of DOM and codecs — so the
 * host reports progress, resolution, and failure while this owns the lifecycle,
 * the pin, and the revision.
 */
export interface LoadProgress {
  readonly loadedBytes: number;
  /** Null when the transport does not report a length. */
  readonly totalBytes: number | null;
  /** 0–1 when the total is known, otherwise null: show indeterminate. */
  readonly ratio: number | null;
}

export class MediaIngestionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaIngestionError";
  }
}

export class MediaIngestion {
  readonly #store: SceneStore;
  readonly #handle: ArtifactHandle;
  readonly #kind: Extract<ArtifactKind, "image" | "video">;
  #progress: LoadProgress = { loadedBytes: 0, totalBytes: null, ratio: null };
  #metadata: MediaMetadata | null = null;
  #settled = false;

  constructor(
    store: SceneStore,
    handle: ArtifactHandle,
    kind: Extract<ArtifactKind, "image" | "video">,
  ) {
    this.#store = store;
    this.#handle = handle;
    this.#kind = kind;
    store.transact((tx) => {
      tx.transition(handle, "loading");
      tx.pin(handle, "loading");
    });
  }

  get kind(): Extract<ArtifactKind, "image" | "video"> {
    return this.#kind;
  }

  get progress(): LoadProgress {
    return this.#progress;
  }

  /** Intrinsic dimensions, available only once the media has resolved. */
  get metadata(): MediaMetadata | null {
    return this.#metadata;
  }

  get settled(): boolean {
    return this.#settled;
  }

  /** Report transfer progress so the frame can show a determinate bar. */
  report(loadedBytes: number, totalBytes: number | null = null): LoadProgress {
    this.#assertOpen();
    if (!Number.isFinite(loadedBytes) || loadedBytes < 0) {
      throw new RangeError(`loadedBytes must be a non-negative finite number, got ${loadedBytes}`);
    }
    if (totalBytes !== null && (!Number.isFinite(totalBytes) || totalBytes < loadedBytes)) {
      throw new RangeError(`totalBytes must be finite and at least loadedBytes, got ${totalBytes}`);
    }
    this.#progress = {
      loadedBytes,
      totalBytes,
      ratio: totalBytes === null || totalBytes === 0 ? null : loadedBytes / totalBytes,
    };
    return this.#progress;
  }

  /**
   * The media decoded. Commits one source revision and leaves the artifact
   * parsed; the host may then request a frame change from the intrinsic size,
   * which only a scene transaction can commit.
   */
  resolve(metadata: MediaMetadata): MediaMetadata {
    this.#assertOpen();
    if (
      !Number.isFinite(metadata.width) ||
      !Number.isFinite(metadata.height) ||
      metadata.width <= 0 ||
      metadata.height <= 0
    ) {
      throw new RangeError("media metadata needs positive finite dimensions");
    }
    if (this.#kind === "video" && metadata.durationMs !== undefined && metadata.durationMs < 0) {
      throw new RangeError("video duration cannot be negative");
    }
    this.#metadata = metadata;
    this.#settled = true;
    this.#store.transact((tx) => {
      tx.bumpSourceRevision(this.#handle);
      tx.transition(this.#handle, "parsed");
      tx.unpin(this.#handle, "loading");
    });
    return metadata;
  }

  /** The fetch or decode failed. The frame keeps its box and shows the reason. */
  fail(code: string, message: string): void {
    this.#assertOpen();
    this.#settled = true;
    this.#store.transact((tx) => {
      tx.fail(this.#handle, { code, message, recoverable: true });
      tx.unpin(this.#handle, "loading");
    });
  }

  #assertOpen(): void {
    if (this.#settled) {
      throw new MediaIngestionError("this media load has already resolved or failed");
    }
  }
}
