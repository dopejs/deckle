import { nodeById, pathToRoot, type InteractionTree } from "@dopejs/deckle-artifact";

/**
 * Run-mode virtual event path (design §9): capture from the artifact root to
 * the target, then bubble back. The path never crosses the artifact frame, so
 * cross-artifact bubbling is impossible by construction.
 */
export interface VirtualEventPath {
  /** Root → target, inclusive. */
  readonly capture: readonly string[];
  readonly target: string;
  /** Target → root, inclusive. */
  readonly bubble: readonly string[];
}

export class EventPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EventPathError";
  }
}

export function computeEventPath(tree: InteractionTree, targetNodeId: string): VirtualEventPath {
  if (!nodeById(tree, targetNodeId)) {
    throw new EventPathError(`target node "${targetNodeId}" is not in the interaction tree`);
  }
  const capture = pathToRoot(tree, targetNodeId);
  return {
    capture,
    target: targetNodeId,
    bubble: [...capture].reverse(),
  };
}
