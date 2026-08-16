/**
 * Explicit resource budgets (design §6.1). There are deliberately no hidden
 * defaults: absolute numbers become gates only after M0 measurement, so every
 * caller — including tests — states its budget.
 */
export interface ResourceBudgets {
  readonly maxLiveArtifacts: number;
  readonly maxLiveDomNodes: number;
  readonly maxIframes: number;
  readonly maxGpuTextureBytes: number;
  readonly maxSnapshotCount: number;
  readonly maxParsedBytes: number;
  readonly maxRuntimeContexts: number;
}

export type BudgetDimension = keyof ResourceBudgets;

export interface BudgetDecision {
  readonly admitted: boolean;
  readonly dimension: BudgetDimension | null;
  readonly requested: number;
  readonly used: number;
  readonly limit: number;
}

export class BudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetError";
  }
}

/**
 * Tracks committed usage per dimension. `tryReserve` is the admission check:
 * it either atomically reserves the amount or rejects with the first violated
 * dimension, so callers can surface a typed diagnostic instead of allocating.
 */
export class BudgetLedger {
  readonly #budgets: ResourceBudgets;
  readonly #used: Record<BudgetDimension, number>;

  constructor(budgets: ResourceBudgets) {
    for (const [key, value] of Object.entries(budgets)) {
      if (!Number.isFinite(value) || value < 0) {
        throw new BudgetError(`Budget "${key}" must be a non-negative finite number, got ${value}`);
      }
    }
    this.#budgets = { ...budgets };
    this.#used = {
      maxLiveArtifacts: 0,
      maxLiveDomNodes: 0,
      maxIframes: 0,
      maxGpuTextureBytes: 0,
      maxSnapshotCount: 0,
      maxParsedBytes: 0,
      maxRuntimeContexts: 0,
    };
  }

  used(dimension: BudgetDimension): number {
    return this.#used[dimension];
  }

  limit(dimension: BudgetDimension): number {
    return this.#budgets[dimension];
  }

  remaining(dimension: BudgetDimension): number {
    return this.#budgets[dimension] - this.#used[dimension];
  }

  tryReserve(request: Partial<Record<BudgetDimension, number>>): BudgetDecision {
    for (const [dimension, amount] of entries(request)) {
      if (!Number.isFinite(amount) || amount < 0) {
        throw new BudgetError(`Reservation for "${dimension}" must be non-negative, got ${amount}`);
      }
      if (this.#used[dimension] + amount > this.#budgets[dimension]) {
        return {
          admitted: false,
          dimension,
          requested: amount,
          used: this.#used[dimension],
          limit: this.#budgets[dimension],
        };
      }
    }
    for (const [dimension, amount] of entries(request)) {
      this.#used[dimension] += amount;
    }
    return { admitted: true, dimension: null, requested: 0, used: 0, limit: 0 };
  }

  release(request: Partial<Record<BudgetDimension, number>>): void {
    for (const [dimension, amount] of entries(request)) {
      if (!Number.isFinite(amount) || amount < 0) {
        throw new BudgetError(`Release for "${dimension}" must be non-negative, got ${amount}`);
      }
      if (amount > this.#used[dimension]) {
        throw new BudgetError(
          `Release of ${amount} for "${dimension}" exceeds committed usage ${this.#used[dimension]}`,
        );
      }
    }
    for (const [dimension, amount] of entries(request)) {
      this.#used[dimension] -= amount;
    }
  }

  snapshot(): Readonly<Record<BudgetDimension, { used: number; limit: number }>> {
    const result = {} as Record<BudgetDimension, { used: number; limit: number }>;
    for (const dimension of Object.keys(this.#used) as BudgetDimension[]) {
      result[dimension] = { used: this.#used[dimension], limit: this.#budgets[dimension] };
    }
    return result;
  }
}

function entries(request: Partial<Record<BudgetDimension, number>>): [BudgetDimension, number][] {
  return Object.entries(request) as [BudgetDimension, number][];
}
