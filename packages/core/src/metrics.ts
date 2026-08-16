/**
 * Frame metrics and trace export (design §17). Values are numeric only; the
 * recorder never accepts artifact source, user text, or generated code, so
 * export is redaction-safe by construction.
 */
export interface FramePhaseSample {
  readonly cameraUpdateMs: number;
  readonly spatialQueryMs: number;
  readonly mountMs: number;
  readonly captureMs: number;
  readonly uploadMs: number;
  readonly compositeMs: number;
}

export interface FrameSample extends FramePhaseSample {
  readonly totalMs: number;
  readonly visibleCount: number;
  readonly liveCount: number;
  readonly snapshotCount: number;
}

export interface PercentileSummary {
  readonly count: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
}

export interface MetricsReport {
  readonly frameTotalMs: PercentileSummary;
  readonly phases: Readonly<Record<keyof FramePhaseSample, PercentileSummary>>;
  readonly counters: Readonly<Record<string, number>>;
}

const EMPTY_SUMMARY: PercentileSummary = { count: 0, p50: 0, p95: 0, p99: 0, max: 0 };

/**
 * Nearest-rank percentile on a sorted copy. Deterministic and documented so
 * benchmark reports can name the method (plan §12).
 */
export function summarizePercentiles(samples: readonly number[]): PercentileSummary {
  if (samples.length === 0) return EMPTY_SUMMARY;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = (p: number): number => {
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.min(Math.max(index, 0), sorted.length - 1)] as number;
  };
  return {
    count: sorted.length,
    p50: rank(50),
    p95: rank(95),
    p99: rank(99),
    max: sorted[sorted.length - 1] as number,
  };
}

export class MetricsRecorder {
  readonly #capacity: number;
  #frames: FrameSample[] = [];
  #counters = new Map<string, number>();

  /** `capacity` bounds the rolling window; older frames fall off. */
  constructor(capacity = 1024) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(`capacity must be a positive integer, got ${capacity}`);
    }
    this.#capacity = capacity;
  }

  recordFrame(sample: FrameSample): void {
    for (const [key, value] of Object.entries(sample)) {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        throw new RangeError(`Frame sample field "${key}" must be a non-negative finite number`);
      }
    }
    this.#frames.push(sample);
    if (this.#frames.length > this.#capacity) {
      this.#frames.splice(0, this.#frames.length - this.#capacity);
    }
  }

  increment(counter: string, amount = 1): void {
    if (!Number.isFinite(amount)) throw new RangeError(`increment must be finite, got ${amount}`);
    this.#counters.set(counter, (this.#counters.get(counter) ?? 0) + amount);
  }

  report(): MetricsReport {
    const phaseKeys: (keyof FramePhaseSample)[] = [
      "cameraUpdateMs",
      "spatialQueryMs",
      "mountMs",
      "captureMs",
      "uploadMs",
      "compositeMs",
    ];
    const phases = {} as Record<keyof FramePhaseSample, PercentileSummary>;
    for (const key of phaseKeys) {
      phases[key] = summarizePercentiles(this.#frames.map((frame) => frame[key]));
    }
    return {
      frameTotalMs: summarizePercentiles(this.#frames.map((frame) => frame.totalMs)),
      phases,
      counters: Object.fromEntries(this.#counters),
    };
  }

  /** JSON-serializable trace of the retained window, for offline analysis. */
  exportTrace(): { frames: readonly FrameSample[]; counters: Readonly<Record<string, number>> } {
    return { frames: [...this.#frames], counters: Object.fromEntries(this.#counters) };
  }

  reset(): void {
    this.#frames = [];
    this.#counters.clear();
  }
}
