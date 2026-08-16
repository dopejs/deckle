import { describe, expect, it } from "vitest";
import {
  createCamera,
  DEFAULT_VISIBILITY_OPTIONS,
  SceneStore,
  VisibilityTracker,
} from "./index.js";

function makeScene(): SceneStore {
  const store = new SceneStore();
  store.transact((tx) => {
    tx.createArtifact("center", { x: -50, y: -50, width: 100, height: 100, zIndex: 0 });
    tx.createArtifact("near-right", { x: 600, y: 0, width: 100, height: 100, zIndex: 0 });
    tx.createArtifact("far", { x: 100_000, y: 100_000, width: 100, height: 100, zIndex: 0 });
  });
  return store;
}

const camera = createCamera({ x: 0, y: 0, zoom: 1, viewportWidth: 1000, viewportHeight: 1000 });

describe("VisibilityTracker", () => {
  it("should classify visible, overscan, and cold artifacts", () => {
    const store = makeScene();
    const sets = new VisibilityTracker().compute(store, camera, {
      ...DEFAULT_VISIBILITY_OPTIONS,
      overscanMargin: 200,
    });
    // Viewport is centered on the camera: world x ∈ [-500, 500]. near-right at
    // x=600 falls inside the 200-unit overscan ring, not the viewport.
    expect(sets.visible).toEqual(["center"]);
    expect(sets.overscan).toEqual(["near-right"]);
    expect(sets.cold).toEqual(["far"]);
    expect(sets.warm).toEqual([]);
  });

  it("should extend overscan along the travel direction", () => {
    const store = new SceneStore();
    store.transact((tx) => {
      tx.createArtifact("ahead", { x: 900, y: 0, width: 50, height: 50, zIndex: 0 });
      tx.createArtifact("behind", { x: -1000, y: 0, width: 50, height: 50, zIndex: 0 });
    });
    const sets = new VisibilityTracker().compute(store, camera, {
      overscanMargin: 10,
      lookAheadSeconds: 1,
      velocityX: 500,
      velocityY: 0,
      warmCapacity: 8,
    });
    expect(sets.overscan).toEqual(["ahead"]);
    expect(sets.cold).toEqual(["behind"]);
  });

  it("should keep recently visible artifacts warm and drop beyond capacity", () => {
    const store = new SceneStore();
    store.transact((tx) => {
      tx.createArtifact("a", { x: 0, y: 0, width: 10, height: 10, zIndex: 0 });
      tx.createArtifact("b", { x: 2000, y: 0, width: 10, height: 10, zIndex: 0 });
      tx.createArtifact("c", { x: 4000, y: 0, width: 10, height: 10, zIndex: 0 });
    });
    const tracker = new VisibilityTracker();
    const options = { ...DEFAULT_VISIBILITY_OPTIONS, overscanMargin: 0, warmCapacity: 1 };
    const cam = (x: number) =>
      createCamera({ x, y: 0, zoom: 1, viewportWidth: 100, viewportHeight: 100 });

    tracker.compute(store, cam(0), options);
    tracker.compute(store, cam(2000), options);
    const sets = tracker.compute(store, cam(4000), options);
    expect(sets.visible).toEqual(["c"]);
    expect(sets.warm).toEqual(["b"]);
    expect(sets.cold).toEqual(["a"]);
  });

  it("should report pinned artifacts regardless of geometry", () => {
    const store = makeScene();
    store.transact((tx) => {
      tx.pin(store.handleOf("far"), "drag");
    });
    const sets = new VisibilityTracker().compute(store, camera);
    expect(sets.pinned).toEqual(["far"]);
    expect(sets.cold).toEqual(["far"]);
  });

  it("should forget removed artifacts instead of leaking recency state", () => {
    const store = makeScene();
    const tracker = new VisibilityTracker();
    tracker.compute(store, camera);
    store.transact((tx) => {
      tx.removeArtifact(store.handleOf("center"));
    });
    const sets = tracker.compute(store, camera);
    const everywhere = [...sets.visible, ...sets.overscan, ...sets.warm, ...sets.cold];
    expect(everywhere).not.toContain("center");
    expect(everywhere).toContain("near-right");
  });

  it("should reject invalid warm capacity", () => {
    const store = makeScene();
    expect(() =>
      new VisibilityTracker().compute(store, camera, {
        ...DEFAULT_VISIBILITY_OPTIONS,
        warmCapacity: -1,
      }),
    ).toThrow(RangeError);
  });
});
