/**
 * Hard caps applied to untrusted inputs before any allocation (design §12).
 * All limits are explicit; there are no hidden defaults in production paths —
 * `DEFAULT_QUOTAS` exists for probes and tests and is intentionally strict.
 */
export interface QuotaLimits {
  readonly maxSourceBytes: number;
  readonly maxDomNodes: number;
  readonly maxAttributesPerNode: number;
  readonly maxAttributeValueLength: number;
  readonly maxNestingDepth: number;
  readonly maxStateBytes: number;
  readonly maxDecodedImagePixels: number;
  readonly maxTextureDimension: number;
  readonly maxTimersPerArtifact: number;
  readonly maxMessagesPerSecond: number;
  readonly maxMessageBytes: number;
}

export const DEFAULT_QUOTAS: QuotaLimits = {
  maxSourceBytes: 512 * 1024,
  maxDomNodes: 5_000,
  maxAttributesPerNode: 32,
  maxAttributeValueLength: 4_096,
  maxNestingDepth: 64,
  maxStateBytes: 256 * 1024,
  maxDecodedImagePixels: 16_777_216,
  maxTextureDimension: 8_192,
  maxTimersPerArtifact: 16,
  maxMessagesPerSecond: 120,
  maxMessageBytes: 64 * 1024,
};

export interface QuotaViolation {
  readonly quota: keyof QuotaLimits;
  readonly actual: number;
  readonly limit: number;
}

export function checkQuota(
  limits: QuotaLimits,
  quota: keyof QuotaLimits,
  actual: number,
): QuotaViolation | null {
  const limit = limits[quota];
  if (!Number.isFinite(actual) || actual < 0) {
    return { quota, actual, limit };
  }
  return actual > limit ? { quota, actual, limit } : null;
}

export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Sliding-window rate limiter for runtime messages. Time is injected so tests
 * and deterministic replays control the clock.
 */
export class MessageRateLimiter {
  readonly #limitPerSecond: number;
  #windowStartMs = Number.NEGATIVE_INFINITY;
  #count = 0;

  constructor(limitPerSecond: number) {
    if (!Number.isInteger(limitPerSecond) || limitPerSecond < 1) {
      throw new RangeError(`limitPerSecond must be a positive integer, got ${limitPerSecond}`);
    }
    this.#limitPerSecond = limitPerSecond;
  }

  /** Returns true when the message is admitted at `nowMs`. */
  admit(nowMs: number): boolean {
    if (!Number.isFinite(nowMs)) throw new RangeError(`nowMs must be finite, got ${nowMs}`);
    if (nowMs < this.#windowStartMs) {
      // A clock that moves backwards must not reopen the budget.
      return false;
    }
    if (nowMs - this.#windowStartMs >= 1000) {
      this.#windowStartMs = nowMs;
      this.#count = 0;
    }
    if (this.#count >= this.#limitPerSecond) return false;
    this.#count += 1;
    return true;
  }
}
