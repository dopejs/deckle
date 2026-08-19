import type { StreamSegmenter, StreamSlice } from "@dopejs/deckle-protocol";
import type { ArtifactHandle, SceneStore } from "./scene-store.js";

/**
 * Streaming ingestion for artifacts an agent is still generating.
 *
 * An agent emits tokens far faster than a canvas should repaint, so chunks are
 * coalesced into render ticks. Sanitization is injected as a port: the engine
 * decides *when* to render and how revisions move, the security package decides
 * *what* is safe to render.
 */
export interface StreamingSourceUpdate {
  readonly status: "streaming" | "complete" | "rejected";
  /** Sanitized HTML decided so far ("" when rejected). */
  readonly html: string;
  readonly reason?: string;
  readonly detail?: string;
}

/** Structural port satisfied by `@dopejs/deckle-security`'s StreamingSanitizer. */
export interface StreamingSourcePort {
  append(chunk: string): StreamingSourceUpdate;
  complete(): StreamingSourceUpdate;
}

export interface SegmentedPort extends StreamingSourcePort {
  /** Everything received so far; the artifact's durable source on completion. */
  readonly buffer: string;
  /** Characters of `buffer` that are stable under the kind's segmentation rule. */
  readonly committedLength: number;
  /** Why the tail is withheld, or null when the whole buffer is stable. */
  readonly pending: string | null;
}

/**
 * Turn any {@link StreamSegmenter} into a port `StreamingIngestion` can drive,
 * so text, markdown, code, JSON, rows, and HTML all stream through one engine.
 *
 * `render` converts the committed prefix into whatever the artifact displays —
 * sanitized HTML, repaired partial JSON, laid-out markdown. Keeping it separate
 * from segmentation means a kind can change how it renders without changing
 * what counts as stable.
 */
export function createSegmentedPort(options: {
  readonly segmenter: StreamSegmenter;
  readonly render?: (committed: string, complete: boolean) => string;
  /** Reject the stream past this many characters. */
  readonly maxChars?: number;
}): SegmentedPort {
  const render = options.render ?? ((committed: string): string => committed);
  const maxChars = options.maxChars ?? Number.POSITIVE_INFINITY;
  let buffer = "";
  let slice: StreamSlice = { committedLength: 0, pending: null };
  let rejected = false;

  const reject = (detail: string): StreamingSourceUpdate => {
    rejected = true;
    return { status: "rejected", html: "", reason: "quota-exceeded", detail };
  };

  return {
    get buffer() {
      return buffer;
    },
    get committedLength() {
      return slice.committedLength;
    },
    get pending() {
      return slice.pending;
    },
    append(chunk) {
      if (rejected) return { status: "rejected", html: "", reason: "quota-exceeded" };
      buffer += chunk;
      if (buffer.length > maxChars) {
        return reject(`stream exceeded ${maxChars} characters`);
      }
      slice = options.segmenter(buffer);
      return {
        status: "streaming",
        html: render(buffer.slice(0, slice.committedLength), false),
      };
    },
    complete() {
      if (rejected) return { status: "rejected", html: "", reason: "quota-exceeded" };
      slice = { committedLength: buffer.length, pending: null };
      return { status: "complete", html: render(buffer, true) };
    },
  };
}

export interface CoalescerOptions {
  /** Minimum wall-clock gap between render ticks. */
  readonly minIntervalMs: number;
  /** Render early once this many characters have accumulated. */
  readonly minChars: number;
}

export const DEFAULT_COALESCER_OPTIONS: CoalescerOptions = {
  minIntervalMs: 66,
  minChars: 512,
};

/**
 * Decides when accumulated stream input is worth a repaint. Time is injected so
 * a recorded agent trace replays to exactly the same render ticks.
 */
export class StreamCoalescer {
  readonly #options: CoalescerOptions;
  #pendingChars = 0;
  #lastRenderMs: number | null = null;

  constructor(options: CoalescerOptions = DEFAULT_COALESCER_OPTIONS) {
    if (!Number.isFinite(options.minIntervalMs) || options.minIntervalMs < 0) {
      throw new RangeError(`minIntervalMs must be >= 0, got ${options.minIntervalMs}`);
    }
    if (!Number.isInteger(options.minChars) || options.minChars < 1) {
      throw new RangeError(`minChars must be a positive integer, got ${options.minChars}`);
    }
    this.#options = options;
  }

  get pendingChars(): number {
    return this.#pendingChars;
  }

  /**
   * Record `chars` of new input at `nowMs` and report whether to render.
   * A final tick always renders so the last tokens are never left unpainted.
   */
  shouldRender(nowMs: number, chars: number, final = false): boolean {
    if (!Number.isFinite(nowMs)) throw new RangeError(`nowMs must be finite, got ${nowMs}`);
    this.#pendingChars += chars;
    if (final) {
      this.#commit(nowMs);
      return true;
    }
    if (this.#pendingChars === 0) return false;
    if (this.#lastRenderMs === null) {
      this.#commit(nowMs);
      return true;
    }
    const elapsed = nowMs - this.#lastRenderMs;
    if (elapsed >= this.#options.minIntervalMs || this.#pendingChars >= this.#options.minChars) {
      this.#commit(nowMs);
      return true;
    }
    return false;
  }

  #commit(nowMs: number): void {
    this.#pendingChars = 0;
    this.#lastRenderMs = nowMs;
  }
}

export interface IngestionResult {
  /** True while nothing is renderable yet, so the frame shows a loading state. */
  readonly loading: boolean;
  readonly status: StreamingSourceUpdate["status"];
  /** True when this chunk produced a new provisional frame. */
  readonly rendered: boolean;
  /** Sanitized HTML to display; unchanged from the previous tick when not rendered. */
  readonly html: string;
  readonly draftRevision: number;
}

export class StreamingIngestionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StreamingIngestionError";
  }
}

/**
 * Drives one artifact's stream: moves it into `streaming`, pins it so it cannot
 * be evicted mid-generation, publishes coalesced provisional paint, and commits
 * exactly one source revision when the stream finishes.
 *
 * A rejected or aborted stream fails the artifact and releases the pin, leaving
 * the last provisional frame visible as a placeholder.
 */
export class StreamingIngestion {
  readonly #store: SceneStore;
  readonly #handle: ArtifactHandle;
  readonly #port: StreamingSourcePort;
  readonly #coalescer: StreamCoalescer;
  #html = "";
  #settled = false;
  /** Loading until the segmenter commits something worth painting. */
  #started = false;

  constructor(
    store: SceneStore,
    handle: ArtifactHandle,
    port: StreamingSourcePort,
    coalescer: StreamCoalescer = new StreamCoalescer(),
  ) {
    this.#store = store;
    this.#handle = handle;
    this.#port = port;
    this.#coalescer = coalescer;
    // An announced artifact is loading, not streaming: until the segmenter
    // commits a first character there is nothing to paint, and a frame with no
    // content and no loading state reads as broken rather than pending.
    store.transact((tx) => {
      tx.transition(handle, "loading");
      tx.pin(handle, "loading");
    });
  }

  get settled(): boolean {
    return this.#settled;
  }

  get html(): string {
    return this.#html;
  }

  push(chunk: string, nowMs: number): IngestionResult {
    this.#assertOpen();
    const update = this.#port.append(chunk);
    if (update.status === "rejected") {
      return this.#fail(update);
    }

    const shouldRender = this.#coalescer.shouldRender(nowMs, chunk.length);
    if (!shouldRender) {
      return {
        status: "streaming",
        loading: !this.#started,
        rendered: false,
        html: this.#html,
        draftRevision: this.#store.get(this.#handle).revisions.draftRevision,
      };
    }

    this.#html = update.html;
    const draftRevision = this.#store.transact((tx) => {
      // Chunks can arrive that commit nothing — "<scr" moves no boundary — so
      // the promotion out of loading keys off renderable content, not receipt.
      if (!this.#started && update.html !== "") {
        this.#started = true;
        tx.transition(this.#handle, "streaming");
        tx.unpin(this.#handle, "loading");
        tx.pin(this.#handle, "streaming");
      }
      const draft = tx.bumpDraftRevision(this.#handle);
      tx.commitProvisionalPaint(this.#handle, draft);
      return draft;
    });
    return {
      status: "streaming",
      loading: !this.#started,
      rendered: true,
      html: this.#html,
      draftRevision,
    };
  }

  /** Finish the stream: commit one source revision and leave the artifact parsed. */
  finish(): IngestionResult {
    this.#assertOpen();
    const update = this.#port.complete();
    if (update.status === "rejected") {
      return this.#fail(update);
    }
    this.#html = update.html;
    this.#settled = true;
    this.#store.transact((tx) => {
      tx.bumpSourceRevision(this.#handle);
      tx.transition(this.#handle, "parsed");
      tx.unpin(this.#handle, this.#started ? "streaming" : "loading");
    });
    return {
      status: "complete",
      loading: false,
      rendered: true,
      html: this.#html,
      draftRevision: this.#store.get(this.#handle).revisions.draftRevision,
    };
  }

  /** Abandon the stream (agent cancelled, timed out, or crashed). */
  abort(reason: string): IngestionResult {
    this.#assertOpen();
    return this.#fail({ status: "rejected", html: "", reason: "aborted", detail: reason });
  }

  #fail(update: StreamingSourceUpdate): IngestionResult {
    this.#settled = true;
    this.#store.transact((tx) => {
      tx.fail(this.#handle, {
        code: update.reason ?? "stream-failed",
        message: update.detail ?? "the artifact stream did not complete",
        recoverable: true,
      });
      tx.unpin(this.#handle, this.#started ? "streaming" : "loading");
    });
    return {
      status: "rejected",
      loading: false,
      rendered: false,
      html: this.#html,
      draftRevision: this.#store.get(this.#handle).revisions.draftRevision,
    };
  }

  #assertOpen(): void {
    if (this.#settled) {
      throw new StreamingIngestionError("the stream has already finished, failed, or been aborted");
    }
  }
}
