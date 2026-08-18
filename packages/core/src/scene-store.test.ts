import type { ArtifactFrame } from "@dopejs/canvas-protocol";
import { describe, expect, it } from "vitest";
import {
  InvalidLifecycleTransitionError,
  PinnedEvictionError,
  SceneStore,
  StaleHandleError,
  StaleRevisionError,
  StaleRuntimeEpochError,
  UnknownArtifactError,
} from "./index.js";

const FRAME: ArtifactFrame = { x: 0, y: 0, width: 100, height: 80, zIndex: 0 };

function storeWithArtifact(): { store: SceneStore; handle: ReturnType<SceneStore["handleOf"]> } {
  const store = new SceneStore();
  const handle = store.transact((tx) => tx.createArtifact("a1", FRAME));
  return { store, handle };
}

describe("SceneStore handles and transactions", () => {
  it("should create an artifact readable through its handle", () => {
    const { store, handle } = storeWithArtifact();
    const record = store.get(handle);
    expect(record.id).toBe("a1");
    expect(record.lifecycle).toBe("cold");
    expect(record.revisions).toEqual({
      sourceRevision: 1,
      stateRevision: 1,
      interactionRevision: 0,
      paintRevision: 0,
      runtimeEpoch: 0,
      draftRevision: 0,
      provisionalPaintRevision: 0,
    });
    expect(store.queryPoint(50, 40)).toEqual(["a1"]);
  });

  it("should reject duplicate artifact ids", () => {
    const { store } = storeWithArtifact();
    expect(() => store.transact((tx) => tx.createArtifact("a1", FRAME))).toThrow(
      'Artifact "a1" already exists',
    );
  });

  it("should invalidate handles when an artifact is removed and recreated", () => {
    const { store, handle } = storeWithArtifact();
    store.transact((tx) => {
      tx.removeArtifact(handle);
    });
    expect(() => store.get(handle)).toThrow(UnknownArtifactError);

    const reborn = store.transact((tx) => tx.createArtifact("a1", FRAME));
    expect(reborn.generation).toBe(handle.generation + 1);
    expect(store.isHandleCurrent(handle)).toBe(false);
    expect(store.isHandleCurrent(reborn)).toBe(true);
    expect(() => store.get(handle)).toThrow(StaleHandleError);
  });

  it("should leave the committed scene and spatial index untouched when a transaction throws", () => {
    const { store, handle } = storeWithArtifact();
    const revisionBefore = store.storeRevision;
    expect(() =>
      store.transact((tx) => {
        tx.setFrame(handle, { x: 500, y: 500, width: 10, height: 10, zIndex: 1 });
        tx.createArtifact("a2", FRAME);
        throw new Error("simulated allocation fault");
      }),
    ).toThrow("simulated allocation fault");

    expect(store.storeRevision).toBe(revisionBefore);
    expect(store.size).toBe(1);
    expect(store.get(handle).frame).toEqual(FRAME);
    expect(store.queryPoint(505, 505)).toEqual([]);
    expect(store.queryPoint(50, 40)).toEqual(["a1"]);
  });

  it("should keep the spatial index in sync with frame updates and removals", () => {
    const { store, handle } = storeWithArtifact();
    store.transact((tx) => {
      tx.setFrame(handle, { x: 1000, y: 1000, width: 50, height: 50, zIndex: 0 });
    });
    expect(store.queryPoint(50, 40)).toEqual([]);
    expect(store.queryPoint(1010, 1010)).toEqual(["a1"]);
    store.transact((tx) => {
      tx.removeArtifact(handle);
    });
    expect(store.queryPoint(1010, 1010)).toEqual([]);
  });

  it("should reject non-finite frames", () => {
    const { store, handle } = storeWithArtifact();
    expect(() => {
      store.transact((tx) => {
        tx.setFrame(handle, { x: Number.NaN, y: 0, width: 1, height: 1, zIndex: 0 });
      });
    }).toThrow(RangeError);
    expect(store.get(handle).frame).toEqual(FRAME);
  });
});

describe("SceneStore lifecycle", () => {
  it("should follow the allowed lifecycle path cold→parsed→snapshot→live→hibernated", () => {
    const { store, handle } = storeWithArtifact();
    store.transact((tx) => {
      tx.transition(handle, "parsed");
      tx.transition(handle, "snapshot");
      tx.transition(handle, "live");
      tx.transition(handle, "hibernated");
    });
    expect(store.get(handle).lifecycle).toBe("hibernated");
  });

  it("should reject disallowed transitions atomically", () => {
    const { store, handle } = storeWithArtifact();
    expect(() => {
      store.transact((tx) => {
        tx.transition(handle, "snapshot");
      });
    }).toThrow(InvalidLifecycleTransitionError);
    expect(store.get(handle).lifecycle).toBe("cold");
  });

  it("should never evict a pinned artifact", () => {
    const { store, handle } = storeWithArtifact();
    store.transact((tx) => {
      tx.transition(handle, "live");
      tx.pin(handle, "focus");
      tx.pin(handle, "composition");
    });
    expect(() => {
      store.transact((tx) => {
        tx.transition(handle, "hibernated");
      });
    }).toThrow(PinnedEvictionError);
    expect(() => {
      store.transact((tx) => {
        tx.removeArtifact(handle);
      });
    }).toThrow(PinnedEvictionError);

    store.transact((tx) => {
      tx.unpin(handle, "focus");
      tx.unpin(handle, "composition");
      tx.transition(handle, "hibernated");
    });
    expect(store.get(handle).lifecycle).toBe("hibernated");
  });

  it("should record a typed failure and allow recovery to cold", () => {
    const { store, handle } = storeWithArtifact();
    store.transact((tx) => {
      tx.fail(handle, { code: "capture-failed", message: "gpu lost", recoverable: true });
    });
    const failed = store.get(handle);
    expect(failed.lifecycle).toBe("failed");
    expect(failed.failure?.code).toBe("capture-failed");

    store.transact((tx) => {
      tx.transition(handle, "cold");
    });
    const recovered = store.get(handle);
    expect(recovered.lifecycle).toBe("cold");
    expect(recovered.failure).toBeNull();
  });
});

describe("SceneStore revisions", () => {
  it("should accept paint and interaction commits for the current revision pair", () => {
    const { store, handle } = storeWithArtifact();
    store.transact((tx) => {
      expect(tx.commitInteraction(handle, 1, 1)).toBe(1);
      expect(tx.commitPaint(handle, 1, 1)).toBe(1);
    });
  });

  it("should reject paint produced against a superseded source revision", () => {
    const { store, handle } = storeWithArtifact();
    store.transact((tx) => tx.bumpSourceRevision(handle));
    expect(() => store.transact((tx) => tx.commitPaint(handle, 1, 1))).toThrow(StaleRevisionError);
    expect(store.get(handle).revisions.paintRevision).toBe(0);
  });

  it("should reject interaction trees produced against a superseded state revision", () => {
    const { store, handle } = storeWithArtifact();
    store.transact((tx) => tx.bumpStateRevision(handle));
    expect(() => store.transact((tx) => tx.commitInteraction(handle, 1, 1))).toThrow(
      StaleRevisionError,
    );
  });

  it("should reject runtime state carrying a stale epoch", () => {
    const { store, handle } = storeWithArtifact();
    store.transact((tx) => tx.bumpRuntimeEpoch(handle));
    expect(() => store.transact((tx) => tx.applyRuntimeState(handle, 0))).toThrow(
      StaleRuntimeEpochError,
    );
    const accepted = store.transact((tx) => tx.applyRuntimeState(handle, 1));
    expect(accepted).toBe(2);
  });
});
