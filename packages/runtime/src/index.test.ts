import { CapabilitySet, DEFAULT_QUOTAS } from "@dopejs/canvas-security";
import { describe, expect, it } from "vitest";
import { RUNTIME_PROTOCOL_VERSION, RuntimeHostBridge, validateRuntimeMessage } from "./index.js";

const BASE = {
  protocolVersion: RUNTIME_PROTOCOL_VERSION,
  artifactId: "a1",
  epoch: 1,
};

function makeBridge(overrides: Partial<ConstructorParameters<typeof RuntimeHostBridge>[0]> = {}) {
  return new RuntimeHostBridge({
    artifactId: "a1",
    epoch: 1,
    capabilities: new CapabilitySet(["storage:artifact-state", "timers"]),
    quotas: DEFAULT_QUOTAS,
    ...overrides,
  });
}

describe("validateRuntimeMessage", () => {
  it("should accept well-formed messages of every kind", () => {
    const messages = [
      { ...BASE, kind: "state-update", state: { a: 1 } },
      { ...BASE, kind: "event", eventType: "click", targetNodeId: "n1" },
      { ...BASE, kind: "frame-request", frame: { width: 100, height: 50 } },
      { ...BASE, kind: "terminated", reason: "completed" },
    ];
    for (const message of messages) {
      expect(validateRuntimeMessage(message).valid, JSON.stringify(message)).toBe(true);
    }
  });

  it.each([
    ["null", null],
    ["string", "hello"],
    ["array", []],
    ["class instance", new Date()],
    ["missing version", { artifactId: "a1", epoch: 1, kind: "terminated", reason: "completed" }],
    ["wrong version", { ...BASE, protocolVersion: 2, kind: "terminated", reason: "completed" }],
    ["unknown kind", { ...BASE, kind: "exec" }],
    ["negative epoch", { ...BASE, epoch: -1, kind: "terminated", reason: "completed" }],
    ["float epoch", { ...BASE, epoch: 1.5, kind: "terminated", reason: "completed" }],
    ["empty artifact id", { ...BASE, artifactId: "", kind: "terminated", reason: "completed" }],
    [
      "oversized artifact id",
      { ...BASE, artifactId: "x".repeat(300), kind: "terminated", reason: "completed" },
    ],
    ["missing state", { ...BASE, kind: "state-update" }],
    ["bad event type", { ...BASE, kind: "event", eventType: "", targetNodeId: "n1" }],
    ["bad target", { ...BASE, kind: "event", eventType: "click", targetNodeId: 42 }],
    ["negative frame", { ...BASE, kind: "frame-request", frame: { width: -1, height: 5 } }],
    [
      "infinite frame",
      { ...BASE, kind: "frame-request", frame: { width: Number.POSITIVE_INFINITY, height: 5 } },
    ],
    ["bad termination reason", { ...BASE, kind: "terminated", reason: "exploded" }],
  ])("should reject %s without throwing", (_label, raw) => {
    const result = validateRuntimeMessage(raw);
    expect(result.valid).toBe(false);
  });
});

describe("RuntimeHostBridge", () => {
  it("should accept a fresh, well-formed state update", () => {
    const result = makeBridge().receive({ ...BASE, kind: "state-update", state: { n: 1 } }, 0);
    expect(result).toEqual({
      accepted: true,
      message: { ...BASE, kind: "state-update", state: { n: 1 } },
    });
  });

  it("should reject stale and future epochs", () => {
    const bridge = makeBridge({ epoch: 2 });
    expect(
      bridge.receive({ ...BASE, epoch: 1, kind: "terminated", reason: "completed" }, 0),
    ).toEqual({
      accepted: false,
      reason: "stale-epoch",
    });
    expect(
      bridge.receive({ ...BASE, epoch: 3, kind: "terminated", reason: "completed" }, 1),
    ).toEqual({
      accepted: false,
      reason: "future-epoch",
    });
  });

  it("should reject messages bound to a different artifact", () => {
    const result = makeBridge().receive(
      { ...BASE, artifactId: "other", kind: "terminated", reason: "completed" },
      0,
    );
    expect(result).toEqual({ accepted: false, reason: "wrong-artifact" });
  });

  it("should reject everything after cancellation", () => {
    const bridge = makeBridge();
    bridge.cancel();
    const result = bridge.receive({ ...BASE, kind: "terminated", reason: "completed" }, 0);
    expect(result).toEqual({ accepted: false, reason: "session-cancelled" });
    expect(bridge.requestTimer()).toBe(false);
  });

  it("should rate-limit message floods without corrupting later windows", () => {
    const bridge = makeBridge({
      quotas: { ...DEFAULT_QUOTAS, maxMessagesPerSecond: 2 },
    });
    const message = { ...BASE, kind: "event", eventType: "click", targetNodeId: "n1" };
    expect(bridge.receive(message, 0).accepted).toBe(true);
    expect(bridge.receive(message, 10).accepted).toBe(true);
    expect(bridge.receive(message, 20)).toEqual({ accepted: false, reason: "rate-limited" });
    expect(bridge.receive(message, 1001).accepted).toBe(true);
  });

  it("should reject oversized and unserializable payloads", () => {
    const bridge = makeBridge({ quotas: { ...DEFAULT_QUOTAS, maxMessageBytes: 128 } });
    const oversized = { ...BASE, kind: "state-update", state: { blob: "x".repeat(1000) } };
    expect(bridge.receive(oversized, 0)).toEqual({ accepted: false, reason: "message-too-large" });

    const cyclic: Record<string, unknown> = { ...BASE, kind: "state-update" };
    cyclic["state"] = cyclic;
    expect(bridge.receive(cyclic, 1)).toEqual({ accepted: false, reason: "message-too-large" });
  });

  it("should reject state that is not durable-serializable", () => {
    const bridge = makeBridge();
    const result = bridge.receive(
      { ...BASE, kind: "state-update", state: { when: Number.POSITIVE_INFINITY } },
      0,
    );
    // JSON.stringify turns Infinity into null for the byte estimate, but the
    // canonical durable-state validation still rejects it.
    expect(result).toEqual({ accepted: false, reason: "state-not-serializable" });
  });

  it("should enforce the durable state byte quota", () => {
    const bridge = makeBridge({ quotas: { ...DEFAULT_QUOTAS, maxStateBytes: 16 } });
    const result = bridge.receive(
      { ...BASE, kind: "state-update", state: { text: "far too large for sixteen bytes" } },
      0,
    );
    expect(result).toEqual({ accepted: false, reason: "state-too-large" });
  });

  it("should deny state persistence without the storage capability", () => {
    const bridge = makeBridge({ capabilities: new CapabilitySet(["timers"]) });
    const result = bridge.receive({ ...BASE, kind: "state-update", state: { n: 1 } }, 0);
    expect(result).toEqual({ accepted: false, reason: "capability-denied" });
  });

  it("should still accept non-storage messages without the storage capability", () => {
    const bridge = makeBridge({ capabilities: new CapabilitySet() });
    const result = bridge.receive(
      { ...BASE, kind: "event", eventType: "click", targetNodeId: "n1" },
      0,
    );
    expect(result.accepted).toBe(true);
  });

  it("should cap timers via the quota and capability", () => {
    const bridge = makeBridge({ quotas: { ...DEFAULT_QUOTAS, maxTimersPerArtifact: 2 } });
    expect(bridge.requestTimer()).toBe(true);
    expect(bridge.requestTimer()).toBe(true);
    expect(bridge.requestTimer()).toBe(false);
    bridge.releaseTimer();
    expect(bridge.requestTimer()).toBe(true);

    const noTimers = makeBridge({ capabilities: new CapabilitySet() });
    expect(noTimers.requestTimer()).toBe(false);
  });

  it("should surface malformed raw input as a typed rejection, never a throw", () => {
    const bridge = makeBridge();
    for (const hostile of [null, 0, "x", [], { kind: "state-update" }, { ...BASE, kind: "exec" }]) {
      const result = bridge.receive(hostile, 0);
      expect(result.accepted).toBe(false);
    }
  });

  it("should reject invalid construction", () => {
    expect(() => makeBridge({ epoch: -1 })).toThrow(RangeError);
    expect(() => makeBridge({ artifactId: "" })).toThrow(RangeError);
  });
});
