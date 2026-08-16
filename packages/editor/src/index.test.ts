import {
  createInteractionTree,
  matrixRotate,
  matrixScale,
  matrixTranslate,
  type InteractionNodeInit,
} from "@dopejs/canvas-artifact";
import { createSeededRandom } from "@dopejs/canvas-spatial";
import { describe, expect, it } from "vitest";
import {
  CachedHitTester,
  computeEventPath,
  escapeToParent,
  EventPathError,
  NaiveHitTester,
  NO_SELECTION,
  resolveClick,
  resolveDeepClick,
  SelectionError,
} from "./index.js";

/**
 * root (0,0,100,100)
 * ├─ panel (translate 10,10; bounds 0,0,60,60; clip 0,0,60,60; paintOrder 1)
 * │   └─ button (translate 5,5; bounds 0,0,20,10)
 * └─ badge (translate 50,50; bounds 0,0,40,40; paintOrder 2)
 */
function fixtureTree() {
  const nodes: InteractionNodeInit[] = [
    { id: "root", bounds: { x: 0, y: 0, width: 100, height: 100 } },
    {
      id: "panel",
      parentId: "root",
      paintOrder: 1,
      transform: matrixTranslate(10, 10),
      bounds: { x: 0, y: 0, width: 60, height: 60 },
      clip: { rect: { x: 0, y: 0, width: 60, height: 60 } },
    },
    {
      id: "button",
      parentId: "panel",
      transform: matrixTranslate(5, 5),
      bounds: { x: 0, y: 0, width: 20, height: 10 },
    },
    {
      id: "badge",
      parentId: "root",
      paintOrder: 2,
      transform: matrixTranslate(50, 50),
      bounds: { x: 0, y: 0, width: 40, height: 40 },
    },
  ];
  return createInteractionTree("a1", 1, 1, nodes);
}

describe.each([
  ["NaiveHitTester", (tree: ReturnType<typeof fixtureTree>) => new NaiveHitTester(tree)],
  ["CachedHitTester", (tree: ReturnType<typeof fixtureTree>) => new CachedHitTester(tree)],
])("%s", (_name, makeTester) => {
  it("should hit nested nodes through composed transforms", () => {
    const tester = makeTester(fixtureTree());
    expect(tester.hitTest(16, 16)?.nodeId).toBe("button");
    expect(tester.hitTest(16, 16)?.path).toEqual(["root", "panel", "button"]);
    expect(tester.hitTest(40, 40)?.nodeId).toBe("panel");
    expect(tester.hitTest(2, 2)?.nodeId).toBe("root");
    expect(tester.hitTest(200, 200)).toBeNull();
  });

  it("should prefer the topmost painted node on overlap", () => {
    // panel (order 1) and badge (order 2) overlap at (55,55); badge paints later.
    const tester = makeTester(fixtureTree());
    expect(tester.hitTest(55, 55)?.nodeId).toBe("badge");
  });

  it("should clip descendants outside the ancestor clip", () => {
    const tree = createInteractionTree("a1", 1, 1, [
      { id: "root", bounds: { x: 0, y: 0, width: 100, height: 100 } },
      {
        id: "clipped",
        parentId: "root",
        clip: { rect: { x: 0, y: 0, width: 10, height: 10 } },
        bounds: { x: 0, y: 0, width: 10, height: 10 },
      },
      {
        id: "overflowing",
        parentId: "clipped",
        transform: matrixTranslate(20, 20),
        bounds: { x: 0, y: 0, width: 30, height: 30 },
      },
    ]);
    const tester = makeTester(tree);
    // (25,25) is inside "overflowing" but outside the ancestor clip.
    expect(tester.hitTest(25, 25)?.nodeId).toBe("root");
    expect(tester.hitTest(5, 5)?.nodeId).toBe("clipped");
  });

  it("should skip pointer-events none nodes but keep their children hittable", () => {
    const tree = createInteractionTree("a1", 1, 1, [
      { id: "root", bounds: { x: 0, y: 0, width: 100, height: 100 } },
      {
        id: "ghost",
        parentId: "root",
        pointerEvents: "none",
        bounds: { x: 0, y: 0, width: 50, height: 50 },
      },
      { id: "child", parentId: "ghost", bounds: { x: 0, y: 0, width: 20, height: 20 } },
    ]);
    const tester = makeTester(tree);
    expect(tester.hitTest(10, 10)?.nodeId).toBe("child");
    expect(tester.hitTest(40, 40)?.nodeId).toBe("root");
  });

  it("should hide invisible subtrees and skip singular transforms", () => {
    const tree = createInteractionTree("a1", 1, 1, [
      { id: "root", bounds: { x: 0, y: 0, width: 100, height: 100 } },
      {
        id: "hidden",
        parentId: "root",
        visible: false,
        bounds: { x: 0, y: 0, width: 50, height: 50 },
      },
      { id: "hidden-child", parentId: "hidden", bounds: { x: 0, y: 0, width: 50, height: 50 } },
      {
        id: "flat",
        parentId: "root",
        transform: matrixScale(0, 1),
        bounds: { x: 0, y: 0, width: 50, height: 50 },
      },
    ]);
    const tester = makeTester(tree);
    expect(tester.hitTest(10, 10)?.nodeId).toBe("root");
  });

  it("should hit rotated nodes in their local space", () => {
    const tree = createInteractionTree("a1", 1, 1, [
      { id: "root", bounds: { x: 0, y: 0, width: 200, height: 200 } },
      {
        id: "rotated",
        parentId: "root",
        // translate then rotate 90°: local (10,0) lands at parent (100, 10).
        transform: { ...matrixRotate(Math.PI / 2), e: 100, f: 0 },
        bounds: { x: 0, y: 0, width: 40, height: 20 },
      },
    ]);
    const tester = makeTester(tree);
    expect(tester.hitTest(95, 10)?.nodeId).toBe("rotated");
    expect(tester.hitTest(150, 10)?.nodeId).toBe("root");
  });
});

describe("differential: CachedHitTester versus NaiveHitTester", () => {
  function randomTree(seed: number) {
    const random = createSeededRandom(seed);
    const inits: InteractionNodeInit[] = [
      { id: "n0", bounds: { x: 0, y: 0, width: 400, height: 400 } },
    ];
    for (let index = 1; index < 40; index += 1) {
      const parent = `n${Math.floor(random() * index)}`;
      const init: InteractionNodeInit = {
        id: `n${index}`,
        parentId: parent,
        paintOrder: Math.floor(random() * 5),
        transform: {
          ...matrixRotate(random() * Math.PI),
          e: (random() - 0.5) * 200,
          f: (random() - 0.5) * 200,
        },
        bounds: { x: 0, y: 0, width: random() * 150, height: random() * 150 },
        ...(random() < 0.2
          ? { clip: { rect: { x: 0, y: 0, width: random() * 100, height: random() * 100 } } }
          : {}),
        ...(random() < 0.1 ? { pointerEvents: "none" as const } : {}),
        ...(random() < 0.05 ? { visible: false } : {}),
      };
      inits.push(init);
    }
    return createInteractionTree("a1", 1, 1, inits);
  }

  it("should agree with the oracle across seeded random trees and points", () => {
    for (const seed of [3, 7, 11, 19, 31]) {
      const tree = randomTree(seed);
      const naive = new NaiveHitTester(tree);
      const cached = new CachedHitTester(tree);
      const random = createSeededRandom(seed * 1000);
      for (let sample = 0; sample < 300; sample += 1) {
        const x = (random() - 0.5) * 600;
        const y = (random() - 0.5) * 600;
        expect(cached.hitTest(x, y), `seed=${seed} point=(${x},${y})`).toEqual(naive.hitTest(x, y));
      }
    }
  });
});

describe("selection model", () => {
  const tree = fixtureTree();

  it("should select the artifact first, then refine one level per click", () => {
    const hitPath = ["root", "panel", "button"];
    const s1 = resolveClick(tree, NO_SELECTION, hitPath);
    expect(s1).toEqual({ kind: "artifact", artifactId: "a1" });
    const s2 = resolveClick(tree, s1, hitPath);
    expect(s2).toEqual({ kind: "node", artifactId: "a1", nodeId: "root" });
    const s3 = resolveClick(tree, s2, hitPath);
    expect(s3).toEqual({ kind: "node", artifactId: "a1", nodeId: "panel" });
    const s4 = resolveClick(tree, s3, hitPath);
    expect(s4).toEqual({ kind: "node", artifactId: "a1", nodeId: "button" });
    // Clicking again at the leaf keeps the leaf.
    expect(resolveClick(tree, s4, hitPath)).toEqual(s4);
  });

  it("should retarget within depth context when clicking a sibling branch", () => {
    const selection = { kind: "node", artifactId: "a1", nodeId: "button" } as const;
    const next = resolveClick(tree, selection, ["root", "badge"]);
    expect(next).toEqual({ kind: "node", artifactId: "a1", nodeId: "badge" });
  });

  it("should deep select the leaf on double click", () => {
    expect(resolveDeepClick(tree, ["root", "panel", "button"])).toEqual({
      kind: "node",
      artifactId: "a1",
      nodeId: "button",
    });
    expect(resolveDeepClick(tree, [])).toEqual({ kind: "artifact", artifactId: "a1" });
  });

  it("should escape from node to parent to artifact to none", () => {
    let selection = resolveDeepClick(tree, ["root", "panel", "button"]);
    selection = escapeToParent(tree, selection);
    expect(selection).toEqual({ kind: "node", artifactId: "a1", nodeId: "panel" });
    selection = escapeToParent(tree, selection);
    expect(selection).toEqual({ kind: "node", artifactId: "a1", nodeId: "root" });
    selection = escapeToParent(tree, selection);
    expect(selection).toEqual({ kind: "artifact", artifactId: "a1" });
    selection = escapeToParent(tree, selection);
    expect(selection).toEqual(NO_SELECTION);
  });

  it("should keep artifact selection when clicking the frame background", () => {
    const selection = resolveClick(tree, { kind: "artifact", artifactId: "a1" }, []);
    expect(selection).toEqual({ kind: "artifact", artifactId: "a1" });
  });

  it("should reject hit paths with unknown nodes", () => {
    expect(() => resolveClick(tree, { kind: "artifact", artifactId: "a1" }, ["ghost"])).toThrow(
      SelectionError,
    );
    expect(() => resolveDeepClick(tree, ["ghost"])).toThrow(SelectionError);
  });
});

describe("event path", () => {
  const tree = fixtureTree();

  it("should compute capture, target, and bubble within one artifact", () => {
    expect(computeEventPath(tree, "button")).toEqual({
      capture: ["root", "panel", "button"],
      target: "button",
      bubble: ["button", "panel", "root"],
    });
  });

  it("should reject unknown targets", () => {
    expect(() => computeEventPath(tree, "ghost")).toThrow(EventPathError);
  });
});
