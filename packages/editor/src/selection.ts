import { nodeById, pathToRoot, type InteractionTree } from "@dopejs/deckle-artifact";

/**
 * Edit-mode selection (design §2.2, plan §7): either a whole artifact or one
 * internal node addressed by its stable id. Selection state is immutable;
 * every operation returns the next state.
 */
export type EditorSelection =
  | { readonly kind: "none" }
  | { readonly kind: "artifact"; readonly artifactId: string }
  | { readonly kind: "node"; readonly artifactId: string; readonly nodeId: string };

export const NO_SELECTION: EditorSelection = { kind: "none" };

export class SelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SelectionError";
  }
}

/**
 * Figma-like progressive click refinement:
 * - nothing (or another artifact) selected → select the clicked artifact;
 * - artifact selected → select the topmost root-level node on the hit path;
 * - node selected → descend one level along the hit path below the current
 *   node; clicking outside the current path retargets to its root-level node.
 */
export function resolveClick(
  tree: InteractionTree,
  current: EditorSelection,
  hitPath: readonly string[],
): EditorSelection {
  const artifactId = tree.artifactId;
  if (current.kind === "none" || current.artifactId !== artifactId) {
    return { kind: "artifact", artifactId };
  }
  if (hitPath.length === 0) {
    // Click on the artifact frame background keeps artifact-level selection.
    return { kind: "artifact", artifactId };
  }
  for (const id of hitPath) {
    if (!nodeById(tree, id)) throw new SelectionError(`hit path references unknown node "${id}"`);
  }
  if (current.kind === "artifact") {
    return { kind: "node", artifactId, nodeId: hitPath[0] as string };
  }
  const currentIndex = hitPath.indexOf(current.nodeId);
  if (currentIndex === -1) {
    const currentPath = pathToRoot(tree, current.nodeId);
    // Shared ancestry keeps depth context: select the hit-path entry at the
    // deepest common depth + 1 when it exists, else the deepest shared entry.
    let commonDepth = 0;
    while (
      commonDepth < currentPath.length - 1 &&
      commonDepth < hitPath.length &&
      currentPath[commonDepth] === hitPath[commonDepth]
    ) {
      commonDepth += 1;
    }
    return {
      kind: "node",
      artifactId,
      nodeId: hitPath[Math.min(commonDepth, hitPath.length - 1)] as string,
    };
  }
  const nextIndex = Math.min(currentIndex + 1, hitPath.length - 1);
  return { kind: "node", artifactId, nodeId: hitPath[nextIndex] as string };
}

/** Deep select (double click): target the leaf of the hit path directly. */
export function resolveDeepClick(
  tree: InteractionTree,
  hitPath: readonly string[],
): EditorSelection {
  if (hitPath.length === 0) return { kind: "artifact", artifactId: tree.artifactId };
  const leaf = hitPath[hitPath.length - 1] as string;
  if (!nodeById(tree, leaf)) throw new SelectionError(`hit path references unknown node "${leaf}"`);
  return { kind: "node", artifactId: tree.artifactId, nodeId: leaf };
}

/** Escape: node → parent node → artifact → none. */
export function escapeToParent(tree: InteractionTree, current: EditorSelection): EditorSelection {
  switch (current.kind) {
    case "none":
      return NO_SELECTION;
    case "artifact":
      return NO_SELECTION;
    case "node": {
      const node = nodeById(tree, current.nodeId);
      if (!node) return { kind: "artifact", artifactId: current.artifactId };
      if (node.parentId === null) return { kind: "artifact", artifactId: current.artifactId };
      return { kind: "node", artifactId: current.artifactId, nodeId: node.parentId };
    }
  }
}
