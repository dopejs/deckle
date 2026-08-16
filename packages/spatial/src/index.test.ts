import { describe, expect, it } from "vitest";
import {
  createSeededRandom,
  GridSpatialIndex,
  InvalidRectError,
  NaiveSpatialIndex,
  rectContainsPoint,
  rectsIntersect,
  type SpatialIndex,
} from "./index.js";

function sortedIds(ids: string[]): string[] {
  return [...ids].sort();
}

describe.each([
  ["NaiveSpatialIndex", () => new NaiveSpatialIndex()],
  ["GridSpatialIndex", () => new GridSpatialIndex()],
])("%s contract", (_name, create) => {
  it("should return an inserted entry from an intersecting rect query", () => {
    const index = create();
    index.set("a", { x: 10, y: 10, width: 100, height: 50 });
    expect(index.queryRect({ x: 50, y: 20, width: 10, height: 10 })).toEqual(["a"]);
    expect(index.size).toBe(1);
  });

  it("should not return entries outside the query rect", () => {
    const index = create();
    index.set("a", { x: 0, y: 0, width: 10, height: 10 });
    expect(index.queryRect({ x: 100, y: 100, width: 10, height: 10 })).toEqual([]);
  });

  it("should include entries that only share an edge with the query rect", () => {
    const index = create();
    index.set("edge", { x: 0, y: 0, width: 10, height: 10 });
    expect(index.queryRect({ x: 10, y: 0, width: 5, height: 5 })).toEqual(["edge"]);
  });

  it("should replace the rect when the same id is set twice", () => {
    const index = create();
    index.set("a", { x: 0, y: 0, width: 10, height: 10 });
    index.set("a", { x: 1000, y: 1000, width: 10, height: 10 });
    expect(index.queryRect({ x: 0, y: 0, width: 20, height: 20 })).toEqual([]);
    expect(index.queryPoint(1005, 1005)).toEqual(["a"]);
    expect(index.size).toBe(1);
  });

  it("should stop returning deleted entries and report deletion status", () => {
    const index = create();
    index.set("a", { x: 0, y: 0, width: 10, height: 10 });
    expect(index.delete("a")).toBe(true);
    expect(index.delete("a")).toBe(false);
    expect(index.queryPoint(5, 5)).toEqual([]);
    expect(index.size).toBe(0);
  });

  it("should hit zero-size rects at their exact point", () => {
    const index = create();
    index.set("point", { x: 42, y: 42, width: 0, height: 0 });
    expect(index.queryPoint(42, 42)).toEqual(["point"]);
    expect(index.queryPoint(42.5, 42)).toEqual([]);
  });

  it("should handle negative and extreme logical coordinates", () => {
    const index = create();
    index.set("neg", { x: -1e9, y: -1e9, width: 100, height: 100 });
    index.set("far", { x: 1e12, y: 1e12, width: 100, height: 100 });
    expect(index.queryPoint(-1e9 + 50, -1e9 + 50)).toEqual(["neg"]);
    expect(index.queryPoint(1e12 + 50, 1e12 + 50)).toEqual(["far"]);
  });

  it("should reject non-finite or negative-extent rects", () => {
    const index = create();
    expect(() => {
      index.set("bad", { x: Number.NaN, y: 0, width: 1, height: 1 });
    }).toThrow(InvalidRectError);
    expect(() => {
      index.set("bad", { x: 0, y: 0, width: -1, height: 1 });
    }).toThrow(InvalidRectError);
    expect(() => {
      index.set("bad", { x: Number.POSITIVE_INFINITY, y: 0, width: 1, height: 1 });
    }).toThrow(InvalidRectError);
    expect(index.size).toBe(0);
  });

  it("should return a defensive copy from get", () => {
    const index = create();
    index.set("a", { x: 0, y: 0, width: 10, height: 10 });
    const rect = index.get("a");
    expect(rect).toEqual({ x: 0, y: 0, width: 10, height: 10 });
    expect(index.get("missing")).toBeUndefined();
  });

  it("should be empty after clear", () => {
    const index = create();
    index.set("a", { x: 0, y: 0, width: 10, height: 10 });
    index.clear();
    expect(index.size).toBe(0);
    expect(index.queryPoint(5, 5)).toEqual([]);
  });
});

describe("GridSpatialIndex oversize handling", () => {
  it("should keep giant frames queryable through the oversize path", () => {
    const index = new GridSpatialIndex({ cellSize: 16, maxCellsPerEntry: 4 });
    index.set("giant", { x: -10_000, y: -10_000, width: 20_000, height: 20_000 });
    index.set("small", { x: 0, y: 0, width: 8, height: 8 });
    expect(sortedIds(index.queryPoint(4, 4))).toEqual(["giant", "small"]);
    expect(sortedIds(index.queryRect({ x: 9_000, y: 9_000, width: 10, height: 10 }))).toEqual([
      "giant",
    ]);
    expect(index.delete("giant")).toBe(true);
    expect(index.queryPoint(9_500, 9_500)).toEqual([]);
  });

  it("should answer world-spanning queries without iterating unbounded cells", () => {
    const index = new GridSpatialIndex({ cellSize: 16 });
    index.set("a", { x: 0, y: 0, width: 10, height: 10 });
    index.set("b", { x: 1e9, y: 1e9, width: 10, height: 10 });
    const hits = index.queryRect({ x: -1e12, y: -1e12, width: 2e12, height: 2e12 });
    expect(sortedIds(hits)).toEqual(["a", "b"]);
  });

  it("should reject invalid construction options", () => {
    expect(() => new GridSpatialIndex({ cellSize: 0 })).toThrow(RangeError);
    expect(() => new GridSpatialIndex({ cellSize: Number.NaN })).toThrow(RangeError);
    expect(() => new GridSpatialIndex({ maxCellsPerEntry: 0 })).toThrow(RangeError);
  });
});

describe("rect helpers", () => {
  it("should treat touching edges as intersecting and containing", () => {
    expect(
      rectsIntersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 10, width: 5, height: 5 }),
    ).toBe(true);
    expect(rectContainsPoint({ x: 0, y: 0, width: 10, height: 10 }, 10, 10)).toBe(true);
    expect(rectContainsPoint({ x: 0, y: 0, width: 10, height: 10 }, 10.001, 10)).toBe(false);
  });
});

describe("differential: GridSpatialIndex versus NaiveSpatialIndex", () => {
  function randomRect(random: () => number, span: number) {
    return {
      x: (random() - 0.5) * span,
      y: (random() - 0.5) * span,
      width: random() * span * 0.1,
      height: random() * span * 0.1,
    };
  }

  function runScenario(seed: number, operations: number, span: number, cellSize: number): void {
    const random = createSeededRandom(seed);
    const naive: SpatialIndex = new NaiveSpatialIndex();
    const grid: SpatialIndex = new GridSpatialIndex({ cellSize, maxCellsPerEntry: 32 });
    const ids: string[] = [];
    const label = `seed=${seed} span=${span} cellSize=${cellSize}`;

    for (let step = 0; step < operations; step += 1) {
      const roll = random();
      if (roll < 0.55 || ids.length === 0) {
        const id = `artifact-${ids.length}`;
        ids.push(id);
        const rect = randomRect(random, span);
        naive.set(id, rect);
        grid.set(id, rect);
      } else if (roll < 0.7) {
        const id = ids[Math.floor(random() * ids.length)] as string;
        const rect = randomRect(random, span);
        naive.set(id, rect);
        grid.set(id, rect);
      } else if (roll < 0.8) {
        const id = ids[Math.floor(random() * ids.length)] as string;
        expect(grid.delete(id), label).toBe(naive.delete(id));
      } else if (roll < 0.9) {
        const query = randomRect(random, span);
        expect(sortedIds(grid.queryRect(query)), `${label} step=${step} queryRect`).toEqual(
          sortedIds(naive.queryRect(query)),
        );
      } else {
        const x = (random() - 0.5) * span;
        const y = (random() - 0.5) * span;
        expect(sortedIds(grid.queryPoint(x, y)), `${label} step=${step} queryPoint`).toEqual(
          sortedIds(naive.queryPoint(x, y)),
        );
      }
      expect(grid.size, label).toBe(naive.size);
    }
  }

  it("should agree with the oracle across seeded random workloads", () => {
    for (const seed of [1, 2, 3, 5, 8, 13, 21, 34]) {
      runScenario(seed, 400, 4_000, 64);
    }
  });

  it("should agree with the oracle at extreme coordinate spans", () => {
    for (const seed of [7, 11, 19]) {
      runScenario(seed, 200, 1e10, 512);
    }
  });

  it("should agree with the oracle when rects dwarf the cell size", () => {
    for (const seed of [23, 29]) {
      runScenario(seed, 200, 2_000, 8);
    }
  });
});
