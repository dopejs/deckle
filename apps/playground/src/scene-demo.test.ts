import { describe, expect, it } from "vitest";
import { artifactFillStyle, buildDemoScene } from "./scene-demo.js";

describe("buildDemoScene", () => {
  it("should build the requested number of artifacts deterministically", () => {
    const first = buildDemoScene(2026, 50);
    const second = buildDemoScene(2026, 50);
    expect(first.store.size).toBe(50);
    expect(first.artifacts.size).toBe(50);
    expect([...first.artifacts.values()]).toEqual([...second.artifacts.values()]);
  });

  it("should register every artifact in the spatial index", () => {
    const { store, artifacts } = buildDemoScene(7, 20);
    for (const artifact of artifacts.values()) {
      const centerX = artifact.frame.x + artifact.frame.width / 2;
      const centerY = artifact.frame.y + artifact.frame.height / 2;
      expect(store.queryPoint(centerX, centerY)).toContain(artifact.id);
    }
  });

  it("should vary scenes across seeds", () => {
    const a = buildDemoScene(1, 10);
    const b = buildDemoScene(2, 10);
    expect([...a.artifacts.values()]).not.toEqual([...b.artifacts.values()]);
  });

  it("should reject invalid counts", () => {
    expect(() => buildDemoScene(1, -1)).toThrow(RangeError);
    expect(() => buildDemoScene(1, 10, 0)).toThrow(RangeError);
  });
});

describe("artifactFillStyle", () => {
  it("should brighten differently for selected artifacts", () => {
    expect(artifactFillStyle(120, false)).not.toBe(artifactFillStyle(120, true));
  });
});
