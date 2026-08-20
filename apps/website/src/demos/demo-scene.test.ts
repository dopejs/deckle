import { describe, expect, it } from "vitest";

import { buildDemoScene } from "./demo-scene";

describe("buildDemoScene", () => {
  it("builds a deterministic indexed corpus", () => {
    const first = buildDemoScene(2026, 50);
    const second = buildDemoScene(2026, 50);

    expect([...first.artifacts.values()]).toEqual([...second.artifacts.values()]);
    expect(first.artifacts.size).toBe(50);
    for (const artifact of first.artifacts.values()) {
      const centerX = artifact.frame.x + artifact.frame.width / 2;
      const centerY = artifact.frame.y + artifact.frame.height / 2;
      expect(first.store.queryPoint(centerX, centerY)).toContain(artifact.id);
    }
  });

  it("rejects invalid corpus sizes", () => {
    expect(() => buildDemoScene(1, -1)).toThrow(RangeError);
    expect(() => buildDemoScene(1, 1, 0)).toThrow(RangeError);
  });
});
