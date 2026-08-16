import { describe, expect, it } from "vitest";
import {
  ARTIFACT_BUNDLE_FORMAT_VERSION,
  HIBERNATION_FORMAT_VERSION,
  IDENTITY_MATRIX,
  InteractionTreeValidationError,
  SerializationError,
  SingularMatrixError,
  canonicalStringify,
  childrenOf,
  createInteractionTree,
  deserializeArtifactBundle,
  deserializeHibernationRecord,
  matrixApply,
  matrixInvert,
  matrixMultiply,
  matrixRotate,
  matrixScale,
  matrixTranslate,
  nodeById,
  pathToRoot,
  serializeArtifactBundle,
  serializeHibernationRecord,
  transformRectBounds,
  type ArtifactBundle,
  type HibernationRecord,
} from "./index.js";

describe("geometry", () => {
  it("should compose translate/scale and apply to points", () => {
    const m = matrixMultiply(matrixTranslate(10, 20), matrixScale(2, 3));
    expect(matrixApply(m, 1, 1)).toEqual({ x: 12, y: 23 });
  });

  it("should invert an affine transform back to the original point", () => {
    const m = matrixMultiply(
      matrixMultiply(matrixTranslate(5, -7), matrixRotate(Math.PI / 3)),
      matrixScale(2, 0.5),
    );
    const inverse = matrixInvert(m);
    const p = matrixApply(m, 3, 4);
    const back = matrixApply(inverse, p.x, p.y);
    expect(back.x).toBeCloseTo(3, 10);
    expect(back.y).toBeCloseTo(4, 10);
  });

  it("should reject inverting a singular matrix", () => {
    expect(() => matrixInvert(matrixScale(0, 1))).toThrow(SingularMatrixError);
  });

  it("should compute rotated rect bounds as an enclosing AABB", () => {
    const bounds = transformRectBounds(matrixRotate(Math.PI / 2), {
      x: 0,
      y: 0,
      width: 10,
      height: 20,
    });
    expect(bounds.x).toBeCloseTo(-20, 10);
    expect(bounds.y).toBeCloseTo(0, 10);
    expect(bounds.width).toBeCloseTo(20, 10);
    expect(bounds.height).toBeCloseTo(10, 10);
  });
});

describe("interaction tree", () => {
  const nodes = [
    { id: "root", bounds: { x: 0, y: 0, width: 100, height: 100 } },
    {
      id: "child-b",
      parentId: "root",
      paintOrder: 2,
      bounds: { x: 10, y: 10, width: 20, height: 20 },
    },
    {
      id: "child-a",
      parentId: "root",
      paintOrder: 1,
      bounds: { x: 0, y: 0, width: 50, height: 50 },
    },
    { id: "leaf", parentId: "child-a", bounds: { x: 5, y: 5, width: 10, height: 10 } },
  ];

  it("should normalize node order deterministically regardless of input order", () => {
    const forward = createInteractionTree("a1", 1, 1, nodes);
    const reversed = createInteractionTree("a1", 1, 1, [...nodes].reverse());
    expect(forward).toEqual(reversed);
    expect(forward.nodes.map((node) => node.id)).toEqual(["root", "child-a", "child-b", "leaf"]);
  });

  it("should default transform, pointer events, visibility, and actions", () => {
    const tree = createInteractionTree("a1", 1, 1, nodes);
    const leaf = nodeById(tree, "leaf");
    expect(leaf?.transform).toEqual(IDENTITY_MATRIX);
    expect(leaf?.pointerEvents).toBe("auto");
    expect(leaf?.visible).toBe(true);
    expect(leaf?.actionIds).toEqual([]);
  });

  it("should navigate children and the path to root", () => {
    const tree = createInteractionTree("a1", 1, 1, nodes);
    expect(childrenOf(tree, "root").map((node) => node.id)).toEqual(["child-a", "child-b"]);
    expect(pathToRoot(tree, "leaf")).toEqual(["root", "child-a", "leaf"]);
  });

  it("should reject duplicate ids, missing parents, and cycles", () => {
    expect(() =>
      createInteractionTree("a1", 1, 1, [
        { id: "x", bounds: { x: 0, y: 0, width: 1, height: 1 } },
        { id: "x", bounds: { x: 0, y: 0, width: 1, height: 1 } },
      ]),
    ).toThrow(InteractionTreeValidationError);
    expect(() =>
      createInteractionTree("a1", 1, 1, [
        { id: "x", parentId: "ghost", bounds: { x: 0, y: 0, width: 1, height: 1 } },
      ]),
    ).toThrow(InteractionTreeValidationError);
    expect(() =>
      createInteractionTree("a1", 1, 1, [
        { id: "x", parentId: "y", bounds: { x: 0, y: 0, width: 1, height: 1 } },
        { id: "y", parentId: "x", bounds: { x: 0, y: 0, width: 1, height: 1 } },
      ]),
    ).toThrow(InteractionTreeValidationError);
  });

  it("should reject invalid geometry and revisions", () => {
    expect(() =>
      createInteractionTree("a1", 1, 1, [
        { id: "x", bounds: { x: Number.NaN, y: 0, width: 1, height: 1 } },
      ]),
    ).toThrow(InteractionTreeValidationError);
    expect(() => createInteractionTree("a1", -1, 1, [])).toThrow(InteractionTreeValidationError);
    expect(() => createInteractionTree("", 1, 1, [])).toThrow(InteractionTreeValidationError);
  });
});

describe("canonical serialization", () => {
  it("should produce identical output for logically equal values", () => {
    expect(canonicalStringify({ b: 1, a: [true, null, "x"] })).toBe(
      canonicalStringify({ a: [true, null, "x"], b: 1 }),
    );
  });

  it("should normalize negative zero and drop undefined object members", () => {
    expect(canonicalStringify({ a: -0, b: undefined })).toBe('{"a":0}');
  });

  it("should reject non-finite numbers, functions, and cycles", () => {
    expect(() => canonicalStringify(Number.POSITIVE_INFINITY)).toThrow(SerializationError);
    expect(() => canonicalStringify({ fn: () => 1 })).toThrow(SerializationError);
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    expect(() => canonicalStringify(cyclic)).toThrow(SerializationError);
  });
});

describe("artifact bundle round trip", () => {
  const bundle: ArtifactBundle = {
    formatVersion: ARTIFACT_BUNDLE_FORMAT_VERSION,
    artifactId: "a1",
    sourceRevision: 3,
    stateRevision: 5,
    source: { kind: "html", content: "<section><h1>hello</h1></section>" },
    state: { counter: 2, items: ["x", "y"], nested: { flag: true } },
    interactionTree: createInteractionTree("a1", 3, 5, [
      { id: "root", bounds: { x: 0, y: 0, width: 100, height: 100 } },
    ]),
  };

  it("should round-trip deterministically", () => {
    const payload = serializeArtifactBundle(bundle);
    const restored = deserializeArtifactBundle(payload);
    expect(restored).toEqual(bundle);
    expect(serializeArtifactBundle(restored)).toBe(payload);
  });

  it("should reject foreign format versions and malformed payloads", () => {
    expect(() => serializeArtifactBundle({ ...bundle, formatVersion: 99 as never })).toThrow(
      SerializationError,
    );
    expect(() => deserializeArtifactBundle("not json")).toThrow(SerializationError);
    expect(() => deserializeArtifactBundle('{"formatVersion":1}')).toThrow(SerializationError);
  });

  it("should reject an interaction tree belonging to a different artifact", () => {
    const foreignTree = createInteractionTree("other", 3, 5, []);
    expect(() => serializeArtifactBundle({ ...bundle, interactionTree: foreignTree })).toThrow(
      SerializationError,
    );
  });
});

describe("hibernation record round trip", () => {
  const record: HibernationRecord = {
    formatVersion: HIBERNATION_FORMAT_VERSION,
    artifactId: "a1",
    sourceRevision: 3,
    stateRevision: 6,
    runtimeEpoch: 2,
    state: { scroll: 120, draft: "text" },
  };

  it("should round-trip deterministically", () => {
    const payload = serializeHibernationRecord(record);
    const restored = deserializeHibernationRecord(payload);
    expect(restored).toEqual(record);
    expect(serializeHibernationRecord(restored)).toBe(payload);
  });

  it("should reject invalid records", () => {
    expect(() => serializeHibernationRecord({ ...record, runtimeEpoch: -1 })).toThrow(
      SerializationError,
    );
    expect(() => serializeHibernationRecord({ ...record, artifactId: "" })).toThrow(
      SerializationError,
    );
    expect(() => deserializeHibernationRecord("[]")).toThrow(SerializationError);
  });
});
