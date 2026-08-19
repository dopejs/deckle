import { createCamera, panCamera, zoomCameraAt } from "@dopejs/deckle-core";
import { describe, expect, it } from "vitest";
import {
  composeFrame,
  PictureLifetimeError,
  ReferencePictureBackend,
  selectLod,
  selectSnapshotScale,
  TextureCache,
  type RetainedPicture,
} from "./index.js";

function picture(artifactId: string, bytes: number, paintRevision = 1): RetainedPicture {
  return {
    artifactId,
    paintRevision,
    widthPx: 100,
    heightPx: 100,
    resolutionScale: 1,
    byteEstimate: bytes,
  };
}

describe("ReferencePictureBackend", () => {
  it("should track live pictures and detect double release", () => {
    const backend = new ReferencePictureBackend();
    const p = backend.createPicture(picture("a", 1000));
    expect(backend.livePictureCount).toBe(1);
    backend.releasePicture(p);
    expect(backend.livePictureCount).toBe(0);
    expect(() => {
      backend.releasePicture(p);
    }).toThrow(PictureLifetimeError);
  });

  it("should reject invalid picture geometry", () => {
    const backend = new ReferencePictureBackend();
    expect(() => backend.createPicture({ ...picture("a", 10), widthPx: -1 })).toThrow(
      PictureLifetimeError,
    );
    expect(() => backend.createPicture({ ...picture("a", 10), resolutionScale: 0 })).toThrow(
      PictureLifetimeError,
    );
  });
});

describe("selectLod", () => {
  it("should map zoom bands to LOD levels", () => {
    expect(selectLod(2)).toBe("live-or-full");
    expect(selectLod(0.75)).toBe("live-or-full");
    expect(selectLod(0.5)).toBe("full-snapshot");
    expect(selectLod(0.2)).toBe("reduced-snapshot");
    expect(selectLod(0.05)).toBe("placeholder");
  });

  it("should reject invalid zoom and inconsistent thresholds", () => {
    expect(() => selectLod(0)).toThrow(RangeError);
    expect(() => selectLod(1, { fullZoom: 0.1, snapshotZoom: 0.5, reducedZoom: 0.01 })).toThrow(
      RangeError,
    );
  });
});

describe("selectSnapshotScale", () => {
  it("should capture at on-screen resolution up to 1:1", () => {
    expect(selectSnapshotScale(0.5, 2, 100, 100, 8192)).toBe(1);
    expect(selectSnapshotScale(2, 1, 100, 100, 8192)).toBe(1);
    expect(selectSnapshotScale(0.25, 1, 100, 100, 8192)).toBe(0.25);
  });

  it("should clamp so no texture side exceeds the dimension quota", () => {
    const scale = selectSnapshotScale(1, 2, 10_000, 500, 8192);
    expect(10_000 * scale).toBeLessThanOrEqual(8192);
    expect(scale).toBeGreaterThan(0);
  });

  it("should reject invalid inputs", () => {
    expect(() => selectSnapshotScale(0, 1, 10, 10, 100)).toThrow(RangeError);
    expect(() => selectSnapshotScale(1, 0, 10, 10, 100)).toThrow(RangeError);
    expect(() => selectSnapshotScale(1, 1, -1, 10, 100)).toThrow(RangeError);
    expect(() => selectSnapshotScale(1, 1, 10, 10, 0)).toThrow(RangeError);
  });
});

describe("TextureCache", () => {
  it("should admit within budget and serve hits with statistics", () => {
    const backend = new ReferencePictureBackend();
    const cache = new TextureCache(backend, { maxTotalBytes: 3000, maxItemBytes: 2000 });
    expect(cache.put(picture("a", 1000))).toEqual({ admitted: true });
    expect(cache.get("a")?.artifactId).toBe("a");
    expect(cache.get("missing")).toBeUndefined();
    const stats = cache.stats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.totalBytes).toBe(1000);
  });

  it("should reject items over the per-item budget without allocation", () => {
    const backend = new ReferencePictureBackend();
    const cache = new TextureCache(backend, { maxTotalBytes: 10_000, maxItemBytes: 100 });
    expect(cache.put(picture("big", 500))).toEqual({ admitted: false, reason: "item-over-budget" });
    expect(backend.livePictureCount).toBe(0);
  });

  it("should evict least-recently-used unpinned entries to fit", () => {
    const backend = new ReferencePictureBackend();
    const cache = new TextureCache(backend, { maxTotalBytes: 2000, maxItemBytes: 1000 });
    cache.put(picture("a", 1000));
    cache.put(picture("b", 1000));
    cache.get("a"); // b becomes LRU
    expect(cache.put(picture("c", 1000))).toEqual({ admitted: true });
    expect(cache.peek("b")).toBeUndefined();
    expect(cache.peek("a")).toBeDefined();
    expect(cache.stats().evictions).toBe(1);
    expect(backend.livePictureCount).toBe(2);
  });

  it("should never evict pinned entries even when admission must fail", () => {
    const backend = new ReferencePictureBackend();
    const cache = new TextureCache(backend, { maxTotalBytes: 2000, maxItemBytes: 1000 });
    cache.put(picture("a", 1000));
    cache.put(picture("b", 1000));
    cache.pin("a");
    cache.pin("b");
    expect(cache.put(picture("c", 1000))).toEqual({
      admitted: false,
      reason: "would-exceed-total",
    });
    expect(cache.peek("a")).toBeDefined();
    expect(cache.peek("b")).toBeDefined();
  });

  it("should replace an artifact's picture in place within budget accounting", () => {
    const backend = new ReferencePictureBackend();
    const cache = new TextureCache(backend, { maxTotalBytes: 1000, maxItemBytes: 1000 });
    cache.put(picture("a", 800, 1));
    expect(cache.put(picture("a", 900, 2))).toEqual({ admitted: true });
    expect(cache.peek("a")?.paintRevision).toBe(2);
    expect(cache.stats().totalBytes).toBe(900);
    expect(backend.livePictureCount).toBe(1);
  });

  it("should release all pictures on clear with no leaks", () => {
    const backend = new ReferencePictureBackend();
    const cache = new TextureCache(backend, { maxTotalBytes: 5000, maxItemBytes: 1000 });
    for (const id of ["a", "b", "c"]) cache.put(picture(id, 500));
    cache.clear();
    expect(backend.livePictureCount).toBe(0);
    expect(cache.stats().itemCount).toBe(0);
  });

  it("should survive repeated churn without leaking (soak)", () => {
    const backend = new ReferencePictureBackend();
    const cache = new TextureCache(backend, { maxTotalBytes: 4000, maxItemBytes: 1000 });
    for (let cycle = 0; cycle < 500; cycle += 1) {
      const id = `artifact-${cycle % 10}`;
      cache.put(picture(id, 400 + (cycle % 3) * 100, cycle));
      cache.get(`artifact-${(cycle + 5) % 10}`);
    }
    const stats = cache.stats();
    expect(stats.totalBytes).toBeLessThanOrEqual(4000);
    expect(backend.livePictureCount).toBe(stats.itemCount);
    cache.clear();
    expect(backend.livePictureCount).toBe(0);
  });
});

describe("composeFrame", () => {
  const camera = createCamera({ x: 0, y: 0, zoom: 2, viewportWidth: 800, viewportHeight: 600 });
  const items = [
    {
      artifactId: "front",
      frame: { x: 10, y: 10, width: 50, height: 40, zIndex: 5 },
      picture: picture("front", 100),
    },
    {
      artifactId: "back",
      frame: { x: 0, y: 0, width: 100, height: 100, zIndex: 1 },
      picture: picture("back", 100),
    },
  ];

  it("should order commands by zIndex and map frames to screen space", () => {
    const frame = composeFrame(camera, items);
    expect(frame.commands.map((command) => command.artifactId)).toEqual(["back", "front"]);
    const front = frame.commands[1];
    expect(front).toMatchObject({ screenX: 420, screenY: 320, screenWidth: 100, screenHeight: 80 });
  });

  it("should reuse the identical retained pictures across camera-only movement", () => {
    const before = composeFrame(camera, items);
    const panned = composeFrame(panCamera(camera, 100, 50), items);
    const zoomed = composeFrame(zoomCameraAt(camera, { x: 0, y: 0 }, 1.5), items);
    for (const [index, command] of before.commands.entries()) {
      expect(panned.commands[index]?.picture).toBe(command.picture);
      expect(zoomed.commands[index]?.picture).toBe(command.picture);
    }
    expect(panned.commands[0]?.screenX).not.toBe(before.commands[0]?.screenX);
  });
});
