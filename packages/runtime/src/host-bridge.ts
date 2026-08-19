import { canonicalStringify, SerializationError } from "@dopejs/deckle-artifact";
import {
  MessageRateLimiter,
  utf8ByteLength,
  type CapabilitySet,
  type QuotaLimits,
} from "@dopejs/deckle-security";
import { validateRuntimeMessage, type RuntimeToHostMessage } from "./messages.js";

/**
 * Per-runtime-session gate between an untrusted runtime and the Scene Store
 * (design §9, plan §8). Every inbound message passes, in order: session
 * liveness → rate limit → byte quota → structural validation → artifact
 * binding → epoch freshness → state payload validation → capability check.
 * The bridge never throws on hostile input; the result is always typed.
 */
export type BridgeRejectionReason =
  | "session-cancelled"
  | "rate-limited"
  | "message-too-large"
  | `malformed:${string}`
  | "wrong-artifact"
  | "stale-epoch"
  | "future-epoch"
  | "state-not-serializable"
  | "state-too-large"
  | "capability-denied";

export type BridgeResult =
  | { readonly accepted: true; readonly message: RuntimeToHostMessage }
  | { readonly accepted: false; readonly reason: BridgeRejectionReason };

export interface RuntimeHostBridgeOptions {
  readonly artifactId: string;
  readonly epoch: number;
  readonly capabilities: CapabilitySet;
  readonly quotas: QuotaLimits;
}

export class RuntimeHostBridge {
  readonly #artifactId: string;
  readonly #epoch: number;
  readonly #capabilities: CapabilitySet;
  readonly #quotas: QuotaLimits;
  readonly #rateLimiter: MessageRateLimiter;
  #cancelled = false;
  #timerCount = 0;

  constructor(options: RuntimeHostBridgeOptions) {
    if (!Number.isInteger(options.epoch) || options.epoch < 0) {
      throw new RangeError(`epoch must be a non-negative integer, got ${options.epoch}`);
    }
    if (!options.artifactId) throw new RangeError("artifactId must be non-empty");
    this.#artifactId = options.artifactId;
    this.#epoch = options.epoch;
    this.#capabilities = options.capabilities;
    this.#quotas = options.quotas;
    this.#rateLimiter = new MessageRateLimiter(options.quotas.maxMessagesPerSecond);
  }

  get cancelled(): boolean {
    return this.#cancelled;
  }

  /**
   * Cancel the session (runtime replaced, hibernated, or torn down). All
   * subsequent messages are rejected regardless of content, so a zombie
   * runtime cannot corrupt a restored artifact.
   */
  cancel(): void {
    this.#cancelled = true;
  }

  /** Timer admission for the controlled runtime's timer capability. */
  requestTimer(): boolean {
    if (this.#cancelled) return false;
    if (!this.#capabilities.has("timers")) return false;
    if (this.#timerCount >= this.#quotas.maxTimersPerArtifact) return false;
    this.#timerCount += 1;
    return true;
  }

  releaseTimer(): void {
    this.#timerCount = Math.max(0, this.#timerCount - 1);
  }

  receive(raw: unknown, nowMs: number): BridgeResult {
    if (this.#cancelled) return { accepted: false, reason: "session-cancelled" };
    if (!this.#rateLimiter.admit(nowMs)) return { accepted: false, reason: "rate-limited" };

    const approximateBytes = safeByteEstimate(raw);
    if (approximateBytes === null || approximateBytes > this.#quotas.maxMessageBytes) {
      return { accepted: false, reason: "message-too-large" };
    }

    const validation = validateRuntimeMessage(raw);
    if (!validation.valid) {
      return { accepted: false, reason: `malformed:${validation.reason}` };
    }
    const message = validation.message;

    if (message.artifactId !== this.#artifactId) {
      return { accepted: false, reason: "wrong-artifact" };
    }
    if (message.epoch < this.#epoch) return { accepted: false, reason: "stale-epoch" };
    if (message.epoch > this.#epoch) return { accepted: false, reason: "future-epoch" };

    if (message.kind === "state-update") {
      let stateBytes: number;
      try {
        stateBytes = utf8ByteLength(canonicalStringify(message.state));
      } catch (error) {
        if (error instanceof SerializationError) {
          return { accepted: false, reason: "state-not-serializable" };
        }
        throw error;
      }
      if (stateBytes > this.#quotas.maxStateBytes) {
        return { accepted: false, reason: "state-too-large" };
      }
      if (!this.#capabilities.has("storage:artifact-state")) {
        return { accepted: false, reason: "capability-denied" };
      }
    }

    return { accepted: true, message };
  }
}

/**
 * Size estimate that never throws: hostile payloads with cycles or exotic
 * values return null and are rejected as oversized.
 */
function safeByteEstimate(raw: unknown): number | null {
  try {
    const encoded = JSON.stringify(raw);
    if (typeof encoded !== "string") return null;
    return utf8ByteLength(encoded);
  } catch {
    return null;
  }
}
