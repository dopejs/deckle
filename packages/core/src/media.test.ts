import type { ArtifactFrame } from "@dopejs/deckle-protocol";
import { describe, expect, it } from "vitest";
import { MediaIngestion, MediaIngestionError, SceneStore } from "./index.js";

const FRAME: ArtifactFrame = { x: 0, y: 0, width: 400, height: 300, zIndex: 0 };

function scene() {
  const store = new SceneStore();
  const handle = store.transact((tx) => tx.createArtifact("gen-1", FRAME));
  return { store, handle };
}

describe("MediaIngestion", () => {
  it("should hold an image in loading and pin it", () => {
    const { store, handle } = scene();
    const media = new MediaIngestion(store, handle, "image");
    const record = store.get(handle);
    expect(record.lifecycle).toBe("loading");
    expect(record.pins).toContain("loading");
    expect(media.metadata).toBeNull();
  });

  it("should report determinate progress when a length is known", () => {
    const { store, handle } = scene();
    const media = new MediaIngestion(store, handle, "video");
    expect(media.report(0).ratio).toBeNull();
    expect(media.report(512, 1024).ratio).toBe(0.5);
    expect(media.progress.loadedBytes).toBe(512);
  });

  it("should reject impossible progress values", () => {
    const { store, handle } = scene();
    const media = new MediaIngestion(store, handle, "image");
    expect(() => media.report(-1)).toThrow(RangeError);
    expect(() => media.report(100, 10)).toThrow(RangeError);
  });

  it("should resolve to parsed with one source revision and release the pin", () => {
    const { store, handle } = scene();
    const before = store.get(handle).revisions.sourceRevision;
    const media = new MediaIngestion(store, handle, "image");
    media.resolve({ width: 1200, height: 800 });
    const record = store.get(handle);
    expect(record.lifecycle).toBe("parsed");
    expect(record.pins).toEqual([]);
    expect(record.revisions.sourceRevision).toBe(before + 1);
    expect(media.metadata).toEqual({ width: 1200, height: 800 });
  });

  it("should go loading to parsed without ever passing through streaming", () => {
    const { store, handle } = scene();
    const seen: string[] = [];
    const observe = () => seen.push(store.get(handle).lifecycle);
    const media = new MediaIngestion(store, handle, "video");
    observe();
    media.report(1200, 2400);
    observe();
    media.resolve({ width: 1920, height: 1080, durationMs: 4000 });
    observe();
    expect(seen).toEqual(["loading", "loading", "parsed"]);
  });

  it("should reject degenerate or impossible metadata", () => {
    const { store, handle } = scene();
    const media = new MediaIngestion(store, handle, "video");
    expect(() => media.resolve({ width: 0, height: 100 })).toThrow(RangeError);
    expect(() => media.resolve({ width: 10, height: 10, durationMs: -1 })).toThrow(RangeError);
  });

  it("should stay open after a rejected resolve so a later attempt can succeed", () => {
    const { store, handle } = scene();
    const media = new MediaIngestion(store, handle, "image");
    expect(() => media.resolve({ width: 0, height: 100 })).toThrow(RangeError);
    expect(media.settled).toBe(false);
    media.resolve({ width: 640, height: 480 });
    expect(store.get(handle).lifecycle).toBe("parsed");
  });

  it("should fail with a typed code and release the pin", () => {
    const { store, handle } = scene();
    const media = new MediaIngestion(store, handle, "image");
    media.fail("decode-failed", "the image data is not a supported format");
    const record = store.get(handle);
    expect(record.lifecycle).toBe("failed");
    expect(record.failure).toMatchObject({ code: "decode-failed", recoverable: true });
    expect(record.pins).toEqual([]);
  });

  it("should refuse further input once settled", () => {
    const { store, handle } = scene();
    const media = new MediaIngestion(store, handle, "image");
    media.resolve({ width: 10, height: 10 });
    expect(() => media.report(1)).toThrow(MediaIngestionError);
    expect(() => media.resolve({ width: 10, height: 10 })).toThrow(MediaIngestionError);
    expect(() => {
      media.fail("x", "y");
    }).toThrow(MediaIngestionError);
  });
});
