import type { Rect } from "@dopejs/deckle-protocol";
import { IDENTITY_MATRIX, isValidMatrix, type Mat2D } from "./geometry.js";

export const INTERACTION_TREE_FORMAT_VERSION = 1 as const;

export interface InteractionClip {
  /** Clip rect in the node's local coordinate space. */
  readonly rect: Rect;
}

/**
 * Retained projection of one supported internal artifact node (design §8).
 * `transform` maps the node's local coordinate system into its parent's space.
 * `bounds` and `clip.rect` are in the node's local space; the clip applies to
 * the node's own paint and its entire subtree.
 */
export interface InteractionNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly bounds: Rect;
  readonly transform: Mat2D;
  readonly clip: InteractionClip | null;
  readonly paintOrder: number;
  readonly pointerEvents: "auto" | "none";
  readonly visible: boolean;
  readonly role: string | null;
  readonly actionIds: readonly string[];
}

export interface InteractionTree {
  readonly formatVersion: typeof INTERACTION_TREE_FORMAT_VERSION;
  readonly artifactId: string;
  /** Source/state pair the tree was extracted from. */
  readonly sourceRevision: number;
  readonly stateRevision: number;
  readonly nodes: readonly InteractionNode[];
}

export class InteractionTreeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InteractionTreeValidationError";
  }
}

export interface InteractionNodeInit {
  readonly id: string;
  readonly parentId?: string | null;
  readonly bounds: Rect;
  readonly transform?: Mat2D;
  readonly clip?: InteractionClip | null;
  readonly paintOrder?: number;
  readonly pointerEvents?: "auto" | "none";
  readonly visible?: boolean;
  readonly role?: string | null;
  readonly actionIds?: readonly string[];
}

function isValidBounds(rect: Rect): boolean {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width >= 0 &&
    rect.height >= 0
  );
}

/**
 * Build and validate a tree. Guarantees after construction: unique non-empty
 * ids, every parent exists, no cycles, roots present, finite geometry.
 * Node order is normalized to (parent-first, then paintOrder, then id) so equal
 * logical trees serialize identically regardless of input order.
 */
export function createInteractionTree(
  artifactId: string,
  sourceRevision: number,
  stateRevision: number,
  inits: readonly InteractionNodeInit[],
): InteractionTree {
  if (!artifactId) throw new InteractionTreeValidationError("artifactId must be non-empty");
  if (!Number.isInteger(sourceRevision) || sourceRevision < 0) {
    throw new InteractionTreeValidationError(`sourceRevision must be a non-negative integer`);
  }
  if (!Number.isInteger(stateRevision) || stateRevision < 0) {
    throw new InteractionTreeValidationError(`stateRevision must be a non-negative integer`);
  }

  const byId = new Map<string, InteractionNode>();
  for (const init of inits) {
    if (!init.id) throw new InteractionTreeValidationError("node id must be non-empty");
    if (byId.has(init.id)) {
      throw new InteractionTreeValidationError(`duplicate node id "${init.id}"`);
    }
    if (!isValidBounds(init.bounds)) {
      throw new InteractionTreeValidationError(`node "${init.id}" has invalid bounds`);
    }
    const transform = init.transform ?? IDENTITY_MATRIX;
    if (!isValidMatrix(transform)) {
      throw new InteractionTreeValidationError(`node "${init.id}" has a non-finite transform`);
    }
    const clip = init.clip ?? null;
    if (clip && !isValidBounds(clip.rect)) {
      throw new InteractionTreeValidationError(`node "${init.id}" has an invalid clip rect`);
    }
    const paintOrder = init.paintOrder ?? 0;
    if (!Number.isFinite(paintOrder)) {
      throw new InteractionTreeValidationError(`node "${init.id}" has a non-finite paintOrder`);
    }
    byId.set(init.id, {
      id: init.id,
      parentId: init.parentId ?? null,
      bounds: { ...init.bounds },
      transform: { ...transform },
      clip: clip ? { rect: { ...clip.rect } } : null,
      paintOrder,
      pointerEvents: init.pointerEvents ?? "auto",
      visible: init.visible ?? true,
      role: init.role ?? null,
      actionIds: [...(init.actionIds ?? [])],
    });
  }

  for (const node of byId.values()) {
    if (node.parentId !== null && !byId.has(node.parentId)) {
      throw new InteractionTreeValidationError(
        `node "${node.id}" references missing parent "${node.parentId}"`,
      );
    }
  }

  // Cycle detection via parent-chain walk with memoized depth.
  const depth = new Map<string, number>();
  const resolveDepth = (id: string, trail: Set<string>): number => {
    const memo = depth.get(id);
    if (memo !== undefined) return memo;
    if (trail.has(id)) {
      throw new InteractionTreeValidationError(`cycle detected through node "${id}"`);
    }
    trail.add(id);
    const node = byId.get(id) as InteractionNode;
    const value = node.parentId === null ? 0 : resolveDepth(node.parentId, trail) + 1;
    depth.set(id, value);
    return value;
  };
  for (const id of byId.keys()) resolveDepth(id, new Set());

  const nodes = [...byId.values()].sort(
    (left, right) =>
      (depth.get(left.id) as number) - (depth.get(right.id) as number) ||
      left.paintOrder - right.paintOrder ||
      (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
  );

  return {
    formatVersion: INTERACTION_TREE_FORMAT_VERSION,
    artifactId,
    sourceRevision,
    stateRevision,
    nodes,
  };
}

export function childrenOf(tree: InteractionTree, parentId: string | null): InteractionNode[] {
  return tree.nodes.filter((node) => node.parentId === parentId);
}

export function nodeById(tree: InteractionTree, id: string): InteractionNode | undefined {
  return tree.nodes.find((node) => node.id === id);
}

/** Path of ids from the root to `id`, inclusive. */
export function pathToRoot(tree: InteractionTree, id: string): string[] {
  const path: string[] = [];
  let current: InteractionNode | undefined = nodeById(tree, id);
  while (current) {
    path.unshift(current.id);
    current = current.parentId === null ? undefined : nodeById(tree, current.parentId);
  }
  return path;
}
