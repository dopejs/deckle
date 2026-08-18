import type { ArtifactFrame } from "@dopejs/canvas-protocol";
import { describe, expect, it } from "vitest";
import {
  PinnedEvictionError,
  SceneStore,
  StreamCoalescer,
  StreamingIngestion,
  StreamingIngestionError,
  type StreamingSourcePort,
  type StreamingSourceUpdate,
} from "./index.js";

const FRAME: ArtifactFrame = { x: 0, y: 0, width: 400, height: 300, zIndex: 0 };

/** Fake port: echoes what it received so tests exercise the engine, not the sanitizer. */
function fakePort(overrides: Partial<Record<"rejectOn" | "rejectAt", string>> = {}) {
  let buffer = "";
  const port: StreamingSourcePort = {
    append(chunk) {
      buffer += chunk;
      if (overrides.rejectOn && buffer.includes(overrides.rejectOn)) {
        return { status: "rejected", html: "", reason: "quota-exceeded", detail: "too big" };
      }
      return { status: "streaming", html: `<safe>${buffer}</safe>` };
    },
    complete(): StreamingSourceUpdate {
      if (overrides.rejectAt && buffer.includes(overrides.rejectAt)) {
        return { status: "rejected", html: "", reason: "unparseable", detail: "bad tail" };
      }
      return { status: "complete", html: `<final>${buffer}</final>` };
    },
  };
  return port;
}

function scene() {
  const store = new SceneStore();
  const handle = store.transact((tx) => tx.createArtifact("gen-1", FRAME));
  return { store, handle };
}

describe("StreamCoalescer", () => {
  it("should render the first chunk immediately", () => {
    const coalescer = new StreamCoalescer({ minIntervalMs: 100, minChars: 1000 });
    expect(coalescer.shouldRender(0, 10)).toBe(true);
  });

  it("should hold back chunks that arrive faster than the interval", () => {
    const coalescer = new StreamCoalescer({ minIntervalMs: 100, minChars: 1000 });
    coalescer.shouldRender(0, 10);
    expect(coalescer.shouldRender(20, 10)).toBe(false);
    expect(coalescer.shouldRender(60, 10)).toBe(false);
    expect(coalescer.shouldRender(100, 10)).toBe(true);
  });

  it("should render early once enough characters accumulate", () => {
    const coalescer = new StreamCoalescer({ minIntervalMs: 1000, minChars: 50 });
    coalescer.shouldRender(0, 1);
    expect(coalescer.shouldRender(1, 20)).toBe(false);
    expect(coalescer.shouldRender(2, 40)).toBe(true);
  });

  it("should always render a final tick", () => {
    const coalescer = new StreamCoalescer({ minIntervalMs: 10_000, minChars: 10_000 });
    coalescer.shouldRender(0, 1);
    expect(coalescer.shouldRender(1, 1, true)).toBe(true);
  });

  it("should reset pending characters after a render", () => {
    const coalescer = new StreamCoalescer({ minIntervalMs: 100, minChars: 50 });
    coalescer.shouldRender(0, 10);
    expect(coalescer.pendingChars).toBe(0);
    coalescer.shouldRender(10, 10);
    expect(coalescer.pendingChars).toBe(10);
  });

  it("should reject invalid options and clocks", () => {
    expect(() => new StreamCoalescer({ minIntervalMs: -1, minChars: 10 })).toThrow(RangeError);
    expect(() => new StreamCoalescer({ minIntervalMs: 10, minChars: 0 })).toThrow(RangeError);
    expect(() => new StreamCoalescer().shouldRender(Number.NaN, 1)).toThrow(RangeError);
  });
});

describe("StreamingIngestion — lifecycle", () => {
  it("should move the artifact into streaming and pin it", () => {
    const { store, handle } = scene();
    new StreamingIngestion(store, handle, fakePort());
    const record = store.get(handle);
    expect(record.lifecycle).toBe("streaming");
    expect(record.pins).toContain("streaming");
  });

  it("should refuse to evict an artifact that is still generating", () => {
    const { store, handle } = scene();
    new StreamingIngestion(store, handle, fakePort());
    expect(() => {
      store.transact((tx) => {
        tx.transition(handle, "cold");
      });
    }).toThrow(PinnedEvictionError);
    expect(() => {
      store.transact((tx) => {
        tx.removeArtifact(handle);
      });
    }).toThrow(PinnedEvictionError);
  });

  it("should commit exactly one source revision when the stream finishes", () => {
    const { store, handle } = scene();
    const ingestion = new StreamingIngestion(
      store,
      handle,
      fakePort(),
      new StreamCoalescer({ minIntervalMs: 0, minChars: 1 }),
    );
    const before = store.get(handle).revisions.sourceRevision;

    ingestion.push("<p>a", 0);
    ingestion.push("</p>", 20);
    expect(store.get(handle).revisions.sourceRevision).toBe(before);

    const result = ingestion.finish();
    expect(result.status).toBe("complete");
    const record = store.get(handle);
    expect(record.revisions.sourceRevision).toBe(before + 1);
    expect(record.lifecycle).toBe("parsed");
    expect(record.pins).not.toContain("streaming");
  });

  it("should reset the draft revision once the source is committed", () => {
    const { store, handle } = scene();
    const ingestion = new StreamingIngestion(
      store,
      handle,
      fakePort(),
      new StreamCoalescer({ minIntervalMs: 0, minChars: 1 }),
    );
    ingestion.push("<p>a</p>", 0);
    expect(store.get(handle).revisions.draftRevision).toBe(1);
    ingestion.finish();
    expect(store.get(handle).revisions.draftRevision).toBe(0);
  });
});

describe("StreamingIngestion — provisional paint", () => {
  it("should publish provisional paint only on render ticks", () => {
    const { store, handle } = scene();
    const ingestion = new StreamingIngestion(
      store,
      handle,
      fakePort(),
      new StreamCoalescer({ minIntervalMs: 100, minChars: 10_000 }),
    );

    const first = ingestion.push("<p>a", 0);
    expect(first.rendered).toBe(true);
    expect(store.get(handle).revisions.provisionalPaintRevision).toBe(1);

    const held = ingestion.push("b", 10);
    expect(held.rendered).toBe(false);
    expect(held.html).toBe(first.html);
    expect(store.get(handle).revisions.provisionalPaintRevision).toBe(1);

    const later = ingestion.push("c", 200);
    expect(later.rendered).toBe(true);
    expect(store.get(handle).revisions.provisionalPaintRevision).toBe(2);
  });

  it("should let authoritative paint supersede the provisional placeholder", () => {
    const { store, handle } = scene();
    const ingestion = new StreamingIngestion(
      store,
      handle,
      fakePort(),
      new StreamCoalescer({ minIntervalMs: 0, minChars: 1 }),
    );
    ingestion.push("<p>a</p>", 0);
    ingestion.finish();
    expect(store.get(handle).revisions.provisionalPaintRevision).toBeGreaterThan(0);

    const revisions = store.get(handle).revisions;
    store.transact((tx) =>
      tx.commitPaint(handle, revisions.sourceRevision, revisions.stateRevision),
    );
    expect(store.get(handle).revisions.provisionalPaintRevision).toBe(0);
    expect(store.get(handle).revisions.paintRevision).toBe(1);
  });

  it("should reject provisional paint rendered against a superseded draft", () => {
    const { store, handle } = scene();
    new StreamingIngestion(store, handle, fakePort());
    const stale = store.transact((tx) => tx.bumpDraftRevision(handle));
    store.transact((tx) => tx.bumpDraftRevision(handle));
    expect(() => store.transact((tx) => tx.commitProvisionalPaint(handle, stale))).toThrow(
      /Stale provisional paint/,
    );
  });
});

describe("StreamingIngestion — failure paths", () => {
  it("should fail the artifact and release the pin when the source is rejected", () => {
    const { store, handle } = scene();
    const ingestion = new StreamingIngestion(store, handle, fakePort({ rejectOn: "BOOM" }));
    const result = ingestion.push("BOOM", 0);
    expect(result.status).toBe("rejected");
    const record = store.get(handle);
    expect(record.lifecycle).toBe("failed");
    expect(record.failure?.code).toBe("quota-exceeded");
    expect(record.pins).not.toContain("streaming");
  });

  it("should keep the last provisional frame visible after a failure", () => {
    const { store, handle } = scene();
    const ingestion = new StreamingIngestion(
      store,
      handle,
      fakePort({ rejectOn: "BOOM" }),
      new StreamCoalescer({ minIntervalMs: 0, minChars: 1 }),
    );
    const good = ingestion.push("<p>partial</p>", 0);
    const failed = ingestion.push("BOOM", 10);
    expect(failed.html).toBe(good.html);
  });

  it("should fail when completion rejects the finished document", () => {
    const { store, handle } = scene();
    const ingestion = new StreamingIngestion(store, handle, fakePort({ rejectAt: "BAD" }));
    ingestion.push("BAD", 0);
    expect(ingestion.finish().status).toBe("rejected");
    expect(store.get(handle).lifecycle).toBe("failed");
  });

  it("should support aborting an abandoned stream", () => {
    const { store, handle } = scene();
    const ingestion = new StreamingIngestion(store, handle, fakePort());
    ingestion.push("<p>half", 0);
    ingestion.abort("agent timed out");
    const record = store.get(handle);
    expect(record.lifecycle).toBe("failed");
    expect(record.failure?.message).toBe("agent timed out");
    expect(record.pins).not.toContain("streaming");
    // The artifact is evictable again once the stream is released.
    expect(() => {
      store.transact((tx) => {
        tx.transition(handle, "cold");
      });
    }).not.toThrow();
  });

  it("should refuse further input once settled", () => {
    const { store, handle } = scene();
    const ingestion = new StreamingIngestion(store, handle, fakePort());
    ingestion.finish();
    expect(() => ingestion.push("x", 1)).toThrow(StreamingIngestionError);
    expect(() => ingestion.finish()).toThrow(StreamingIngestionError);
  });
});
