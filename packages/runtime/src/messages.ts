import type { DurableState } from "@dopejs/deckle-artifact";

/**
 * Versioned message vocabulary between a controlled artifact runtime and the
 * host (design §9). Every inbound value is untrusted: validation is fail
 * closed, never throws on malformed input, and returns a typed reason.
 */
export const RUNTIME_PROTOCOL_VERSION = 1 as const;

export interface RuntimeMessageBase {
  readonly protocolVersion: typeof RUNTIME_PROTOCOL_VERSION;
  readonly artifactId: string;
  /** Runtime epoch the sender believes it belongs to. */
  readonly epoch: number;
}

/** Runtime → host: durable state changed. */
export interface StateUpdateMessage extends RuntimeMessageBase {
  readonly kind: "state-update";
  readonly state: DurableState;
}

/** Runtime → host: a supported virtual event fired inside the artifact. */
export interface RuntimeEventMessage extends RuntimeMessageBase {
  readonly kind: "event";
  readonly eventType: string;
  readonly targetNodeId: string;
}

/** Runtime → host: content requests a new frame; only the host may commit it. */
export interface FrameRequestMessage extends RuntimeMessageBase {
  readonly kind: "frame-request";
  readonly frame: { readonly width: number; readonly height: number };
}

/** Runtime → host: the runtime finished or crashed. */
export interface TerminatedMessage extends RuntimeMessageBase {
  readonly kind: "terminated";
  readonly reason: "completed" | "crashed" | "cancelled" | "timeout";
}

export type RuntimeToHostMessage =
  StateUpdateMessage | RuntimeEventMessage | FrameRequestMessage | TerminatedMessage;

export type MessageValidation =
  | { readonly valid: true; readonly message: RuntimeToHostMessage }
  | { readonly valid: false; readonly reason: string };

const KINDS = new Set(["state-update", "event", "frame-request", "terminated"]);
const TERMINATION_REASONS = new Set(["completed", "crashed", "cancelled", "timeout"]);
const MAX_ID_LENGTH = 256;
const MAX_EVENT_TYPE_LENGTH = 64;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH;
}

/**
 * Structural validation only — epoch freshness, rate, and capability checks
 * belong to the host bridge, which runs them after this gate.
 */
export function validateRuntimeMessage(raw: unknown): MessageValidation {
  if (!isPlainObject(raw)) return { valid: false, reason: "not-a-plain-object" };
  if (raw["protocolVersion"] !== RUNTIME_PROTOCOL_VERSION) {
    return { valid: false, reason: "unsupported-protocol-version" };
  }
  if (!isSafeId(raw["artifactId"])) return { valid: false, reason: "invalid-artifact-id" };
  const epoch = raw["epoch"];
  if (typeof epoch !== "number" || !Number.isInteger(epoch) || epoch < 0) {
    return { valid: false, reason: "invalid-epoch" };
  }
  const kind = raw["kind"];
  if (typeof kind !== "string" || !KINDS.has(kind)) {
    return { valid: false, reason: "unknown-kind" };
  }

  switch (kind) {
    case "state-update": {
      if (!("state" in raw)) return { valid: false, reason: "missing-state" };
      return { valid: true, message: raw as unknown as StateUpdateMessage };
    }
    case "event": {
      const eventType = raw["eventType"];
      if (
        typeof eventType !== "string" ||
        eventType.length === 0 ||
        eventType.length > MAX_EVENT_TYPE_LENGTH
      ) {
        return { valid: false, reason: "invalid-event-type" };
      }
      if (!isSafeId(raw["targetNodeId"])) return { valid: false, reason: "invalid-target-node" };
      return { valid: true, message: raw as unknown as RuntimeEventMessage };
    }
    case "frame-request": {
      const frame = raw["frame"];
      if (!isPlainObject(frame)) return { valid: false, reason: "invalid-frame" };
      const width = frame["width"];
      const height = frame["height"];
      if (
        typeof width !== "number" ||
        typeof height !== "number" ||
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        width < 0 ||
        height < 0
      ) {
        return { valid: false, reason: "invalid-frame" };
      }
      return { valid: true, message: raw as unknown as FrameRequestMessage };
    }
    case "terminated": {
      const reason = raw["reason"];
      if (typeof reason !== "string" || !TERMINATION_REASONS.has(reason)) {
        return { valid: false, reason: "invalid-termination-reason" };
      }
      return { valid: true, message: raw as unknown as TerminatedMessage };
    }
    default:
      return { valid: false, reason: "unknown-kind" };
  }
}
