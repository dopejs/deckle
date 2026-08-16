import { describe, expect, it } from "vitest";
import { BudgetError, BudgetLedger, MetricsRecorder, summarizePercentiles } from "./index.js";
import type { INPUT_TRACE_FORMAT_VERSION } from "./index.js";
import { createCamera, InputTraceRecorder, replayInputTrace } from "./index.js";

describe("summarizePercentiles", () => {
  it("should return zeros for an empty sample set", () => {
    expect(summarizePercentiles([])).toEqual({ count: 0, p50: 0, p95: 0, p99: 0, max: 0 });
  });

  it("should compute nearest-rank percentiles", () => {
    const samples = Array.from({ length: 100 }, (_, i) => i + 1);
    const summary = summarizePercentiles(samples);
    expect(summary).toEqual({ count: 100, p50: 50, p95: 95, p99: 99, max: 100 });
  });

  it("should not mutate the input samples", () => {
    const samples = [3, 1, 2];
    summarizePercentiles(samples);
    expect(samples).toEqual([3, 1, 2]);
  });
});

describe("MetricsRecorder", () => {
  const sample = {
    cameraUpdateMs: 1,
    spatialQueryMs: 2,
    mountMs: 0,
    captureMs: 0,
    uploadMs: 0,
    compositeMs: 3,
    totalMs: 6,
    visibleCount: 10,
    liveCount: 1,
    snapshotCount: 9,
  };

  it("should report percentiles per phase and counters", () => {
    const recorder = new MetricsRecorder();
    recorder.recordFrame(sample);
    recorder.recordFrame({ ...sample, totalMs: 10 });
    recorder.increment("evictions");
    recorder.increment("evictions", 2);
    const report = recorder.report();
    expect(report.frameTotalMs.count).toBe(2);
    expect(report.frameTotalMs.max).toBe(10);
    expect(report.phases.compositeMs.p50).toBe(3);
    expect(report.counters["evictions"]).toBe(3);
  });

  it("should bound the rolling window by capacity", () => {
    const recorder = new MetricsRecorder(2);
    recorder.recordFrame({ ...sample, totalMs: 1 });
    recorder.recordFrame({ ...sample, totalMs: 2 });
    recorder.recordFrame({ ...sample, totalMs: 3 });
    expect(recorder.exportTrace().frames.map((frame) => frame.totalMs)).toEqual([2, 3]);
  });

  it("should reject negative or non-finite samples", () => {
    const recorder = new MetricsRecorder();
    expect(() => {
      recorder.recordFrame({ ...sample, totalMs: -1 });
    }).toThrow(RangeError);
    expect(() => {
      recorder.recordFrame({ ...sample, captureMs: Number.NaN });
    }).toThrow(RangeError);
  });

  it("should reject an invalid capacity", () => {
    expect(() => new MetricsRecorder(0)).toThrow(RangeError);
  });
});

describe("BudgetLedger", () => {
  const budgets = {
    maxLiveArtifacts: 3,
    maxLiveDomNodes: 1000,
    maxIframes: 1,
    maxGpuTextureBytes: 1024,
    maxSnapshotCount: 10,
    maxParsedBytes: 4096,
    maxRuntimeContexts: 2,
  };

  it("should admit reservations within budget and track usage", () => {
    const ledger = new BudgetLedger(budgets);
    const decision = ledger.tryReserve({ maxLiveArtifacts: 2, maxGpuTextureBytes: 512 });
    expect(decision.admitted).toBe(true);
    expect(ledger.used("maxLiveArtifacts")).toBe(2);
    expect(ledger.remaining("maxGpuTextureBytes")).toBe(512);
  });

  it("should reject over-budget reservations without partial commitment", () => {
    const ledger = new BudgetLedger(budgets);
    const decision = ledger.tryReserve({ maxLiveArtifacts: 1, maxGpuTextureBytes: 2048 });
    expect(decision.admitted).toBe(false);
    expect(decision.dimension).toBe("maxGpuTextureBytes");
    expect(ledger.used("maxLiveArtifacts")).toBe(0);
    expect(ledger.used("maxGpuTextureBytes")).toBe(0);
  });

  it("should release usage and reject releasing more than committed", () => {
    const ledger = new BudgetLedger(budgets);
    ledger.tryReserve({ maxSnapshotCount: 4 });
    ledger.release({ maxSnapshotCount: 3 });
    expect(ledger.used("maxSnapshotCount")).toBe(1);
    expect(() => {
      ledger.release({ maxSnapshotCount: 2 });
    }).toThrow(BudgetError);
  });

  it("should reject invalid budget configuration and reservations", () => {
    expect(() => new BudgetLedger({ ...budgets, maxIframes: -1 })).toThrow(BudgetError);
    const ledger = new BudgetLedger(budgets);
    expect(() => ledger.tryReserve({ maxIframes: Number.NaN })).toThrow(BudgetError);
  });
});

describe("input trace", () => {
  it("should replay to the identical camera", () => {
    const initial = createCamera({ x: 0, y: 0, zoom: 1, viewportWidth: 800, viewportHeight: 600 });
    const recorder = new InputTraceRecorder(initial);
    recorder.apply({ kind: "pan", dx: 120, dy: -40 });
    recorder.apply({ kind: "zoom", anchorX: 400, anchorY: 300, factor: 2 });
    recorder.apply({ kind: "resize", width: 1024, height: 768 });
    recorder.apply({ kind: "pan", dx: -10, dy: 5 });

    const replayed = replayInputTrace(recorder.trace());
    expect(replayed).toEqual(recorder.camera);
  });

  it("should reject unknown trace format versions", () => {
    const initial = createCamera({ viewportWidth: 10, viewportHeight: 10 });
    expect(() =>
      replayInputTrace({
        formatVersion: 2 as unknown as typeof INPUT_TRACE_FORMAT_VERSION,
        initialCamera: initial,
        events: [],
      }),
    ).toThrow(RangeError);
  });
});
