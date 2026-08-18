import { checkQuota, DEFAULT_QUOTAS, utf8ByteLength, type QuotaViolation } from "./quotas.js";
import { computeSafePrefix, type PendingReason } from "./safe-prefix.js";
import { sanitizeHtml, type SanitizeDiagnostic, type SanitizeOptions } from "./sanitizer.js";

/**
 * Incremental sanitizer for artifacts an agent is still generating.
 *
 * Each `append` sanitizes only the safe prefix (see {@link computeSafePrefix}),
 * so a half-written tag or an unterminated `<script>` is never handed to a
 * renderer. `complete` sanitizes the finished document and is the only result
 * an artifact may treat as authoritative.
 *
 * Source-byte quotas are enforced while streaming rather than at the end, so a
 * runaway generator is cut off instead of buffered without bound. A rejected
 * stream stays rejected: later chunks cannot revive it.
 */
export type StreamingStatus = "streaming" | "complete" | "rejected";

export interface StreamingUpdate {
  readonly status: StreamingStatus;
  /** Sanitized HTML for the decided part of the stream ("" when rejected). */
  readonly html: string;
  /** Characters of the raw buffer that are decided so far. */
  readonly safeLength: number;
  /** Characters received so far. */
  readonly receivedLength: number;
  /** Why the tail is withheld, or null when everything received is decided. */
  readonly pending: PendingReason | null;
  readonly elementCount: number;
  readonly diagnostics: readonly SanitizeDiagnostic[];
  /** Set only when `status` is "rejected". */
  readonly reason?: string;
  readonly detail?: string;
  readonly violation?: QuotaViolation;
}

export class StreamingSanitizerStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StreamingSanitizerStateError";
  }
}

export class StreamingSanitizer {
  readonly #options: SanitizeOptions;
  #buffer = "";
  #lastSafeLength = -1;
  #cached: StreamingUpdate | null = null;
  #terminal: StreamingUpdate | null = null;

  constructor(options: SanitizeOptions = {}) {
    this.#options = options;
  }

  get receivedLength(): number {
    return this.#buffer.length;
  }

  /** Latest update without advancing the stream, for HUDs and devtools. */
  get current(): StreamingUpdate {
    return (
      this.#terminal ??
      this.#cached ?? {
        status: "streaming",
        html: "",
        safeLength: 0,
        receivedLength: this.#buffer.length,
        pending: null,
        elementCount: 0,
        diagnostics: [],
      }
    );
  }

  /** Raw source accumulated so far; the artifact's durable source on completion. */
  get source(): string {
    return this.#buffer;
  }

  append(chunk: string): StreamingUpdate {
    if (this.#terminal) return this.#terminal;

    this.#buffer += chunk;

    const quotas = this.#options.quotas ?? DEFAULT_QUOTAS;
    const violation = checkQuota(quotas, "maxSourceBytes", utf8ByteLength(this.#buffer));
    if (violation) {
      return this.#reject("quota-exceeded", `stream exceeded maxSourceBytes`, violation);
    }

    const prefix = computeSafePrefix(this.#buffer);
    // Most token-sized chunks land inside a tag and move no boundary; reuse the
    // previous result instead of re-sanitizing the whole prefix.
    if (prefix.length === this.#lastSafeLength && this.#cached) {
      const cached = this.#cached;
      this.#cached = { ...cached, receivedLength: this.#buffer.length, pending: prefix.pending };
      return this.#cached;
    }

    const result = sanitizeHtml(this.#buffer.slice(0, prefix.length), this.#options);
    if (!result.ok) {
      return this.#reject(result.reason, result.detail, result.violation);
    }

    this.#lastSafeLength = prefix.length;
    this.#cached = {
      status: "streaming",
      html: result.html,
      safeLength: prefix.length,
      receivedLength: this.#buffer.length,
      pending: prefix.pending,
      elementCount: result.elementCount,
      diagnostics: result.diagnostics,
    };
    return this.#cached;
  }

  /** Finish the stream and sanitize the complete document. */
  complete(): StreamingUpdate {
    if (this.#terminal) return this.#terminal;

    const result = sanitizeHtml(this.#buffer, this.#options);
    if (!result.ok) {
      return this.#reject(result.reason, result.detail, result.violation);
    }
    this.#terminal = {
      status: "complete",
      html: result.html,
      safeLength: this.#buffer.length,
      receivedLength: this.#buffer.length,
      pending: null,
      elementCount: result.elementCount,
      diagnostics: result.diagnostics,
    };
    return this.#terminal;
  }

  #reject(reason: string, detail: string, violation?: QuotaViolation): StreamingUpdate {
    this.#terminal = {
      status: "rejected",
      html: "",
      safeLength: 0,
      receivedLength: this.#buffer.length,
      pending: null,
      elementCount: 0,
      diagnostics: [],
      reason,
      detail,
      ...(violation ? { violation } : {}),
    };
    return this.#terminal;
  }
}
