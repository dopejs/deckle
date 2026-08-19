import {
  childrenOf,
  matrixApply,
  matrixInvert,
  matrixMultiply,
  SingularMatrixError,
  type InteractionNode,
  type InteractionTree,
  type Mat2D,
} from "@dopejs/deckle-artifact";
import { rectContainsPoint } from "@dopejs/deckle-spatial";

/**
 * Hit-testing semantics (design §8):
 * - `transform` maps node-local space into parent space; the test point is
 *   pulled into local space through inverted transforms along the path.
 * - a node is hittable when it is visible, `pointerEvents` is "auto", the
 *   local point lies inside `bounds`, and inside every ancestor clip.
 * - an invisible or clipped-out node hides its whole subtree; a
 *   `pointerEvents: none` node is transparent itself but its children remain
 *   hittable.
 * - paint order: parents paint before children; siblings by `paintOrder`,
 *   ties by id. The topmost painted hit wins.
 * - a non-invertible transform makes the node and subtree unhittable.
 */
export interface HitResult {
  readonly nodeId: string;
  /** Ids from the root to the hit node, inclusive. */
  readonly path: readonly string[];
}

export interface HitTester {
  hitTest(x: number, y: number): HitResult | null;
}

/**
 * Naive oracle: full recursive traversal in paint order, recomputing every
 * inverse transform per query. Kept as the differential reference and
 * rollback path for optimized testers.
 */
export class NaiveHitTester implements HitTester {
  readonly #tree: InteractionTree;

  constructor(tree: InteractionTree) {
    this.#tree = tree;
  }

  hitTest(x: number, y: number): HitResult | null {
    let best: HitResult | null = null;
    const visit = (
      node: InteractionNode,
      parentPoint: { x: number; y: number },
      path: string[],
    ): void => {
      if (!node.visible) return;
      let inverse: Mat2D;
      try {
        inverse = matrixInvert(node.transform);
      } catch (error) {
        if (error instanceof SingularMatrixError) return;
        throw error;
      }
      const local = matrixApply(inverse, parentPoint.x, parentPoint.y);
      if (node.clip && !rectContainsPoint(node.clip.rect, local.x, local.y)) return;
      const nextPath = [...path, node.id];
      if (node.pointerEvents === "auto" && rectContainsPoint(node.bounds, local.x, local.y)) {
        best = { nodeId: node.id, path: nextPath };
      }
      for (const child of childrenOf(this.#tree, node.id)) {
        visit(child, local, nextPath);
      }
    };
    for (const root of childrenOf(this.#tree, null)) {
      visit(root, { x, y }, []);
    }
    return best;
  }
}

interface FlattenedNode {
  readonly node: InteractionNode;
  readonly path: readonly string[];
  /** Inverse of the local→artifact composite transform. */
  readonly inverseWorld: Mat2D;
  /** Clips to test, each paired with the inverse transform into its space. */
  readonly clips: readonly { readonly rect: InteractionNode["bounds"]; readonly inverse: Mat2D }[];
}

/**
 * Cached tester: flattens the tree once, precomputing composite inverse
 * transforms and the clip chain per node, then tests nodes in reverse paint
 * order and returns the first hit. Differentially tested against
 * {@link NaiveHitTester}.
 */
export class CachedHitTester implements HitTester {
  readonly #paintOrdered: FlattenedNode[] = [];

  constructor(tree: InteractionTree) {
    const flatten = (
      node: InteractionNode,
      parentWorld: Mat2D,
      parentClips: FlattenedNode["clips"],
      parentPath: readonly string[],
    ): void => {
      if (!node.visible) return;
      const world = matrixMultiply(parentWorld, node.transform);
      let inverseWorld: Mat2D;
      try {
        inverseWorld = matrixInvert(world);
      } catch (error) {
        if (error instanceof SingularMatrixError) return;
        throw error;
      }
      const path = [...parentPath, node.id];
      const clips = node.clip
        ? [...parentClips, { rect: node.clip.rect, inverse: inverseWorld }]
        : parentClips;
      this.#paintOrdered.push({ node, path, inverseWorld, clips });
      for (const child of childrenOf(tree, node.id)) {
        flatten(child, world, clips, path);
      }
    };
    const identity: Mat2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    for (const root of childrenOf(tree, null)) {
      flatten(root, identity, [], []);
    }
  }

  hitTest(x: number, y: number): HitResult | null {
    for (let index = this.#paintOrdered.length - 1; index >= 0; index -= 1) {
      const entry = this.#paintOrdered[index] as FlattenedNode;
      if (entry.node.pointerEvents !== "auto") continue;
      let clipped = false;
      for (const clip of entry.clips) {
        const inClipSpace = matrixApply(clip.inverse, x, y);
        if (!rectContainsPoint(clip.rect, inClipSpace.x, inClipSpace.y)) {
          clipped = true;
          break;
        }
      }
      if (clipped) continue;
      const local = matrixApply(entry.inverseWorld, x, y);
      if (rectContainsPoint(entry.node.bounds, local.x, local.y)) {
        return { nodeId: entry.node.id, path: entry.path };
      }
    }
    return null;
  }
}
