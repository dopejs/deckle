/**
 * Initial vocabulary shared by feasibility probes. This is not yet a stable public protocol;
 * M0 evidence may change it before the first release.
 */

export const PROTOCOL_VERSION = 0 as const;

export type ArtifactId = string;
export type ArtifactRevision = number;
export type InteractionNodeId = string;

/**
 * `streaming` covers artifacts an agent is still generating: the source is an
 * incomplete but growing prefix, so paint produced from it is provisional and
 * no authoritative interaction tree exists yet. A streaming artifact can only
 * become `parsed` (its source completed) or be abandoned back to `cold`.
 */
export type ArtifactLifecycleState =
  "cold" | "streaming" | "parsed" | "snapshot" | "live" | "hibernated" | "failed";

export type ArtifactMode = "edit" | "run";

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ArtifactFrame extends Rect {
  readonly zIndex: number;
}

export interface ArtifactDescriptor {
  readonly id: ArtifactId;
  readonly revision: ArtifactRevision;
  readonly frame: ArtifactFrame;
  readonly mode: ArtifactMode;
}

export interface InteractionNodeSnapshot {
  readonly id: InteractionNodeId;
  readonly parentId: InteractionNodeId | null;
  readonly bounds: Rect;
  readonly paintOrder: number;
  readonly pointerEvents: "auto" | "none";
  readonly role?: string;
  readonly actionIds?: readonly string[];
}

export interface ArtifactSnapshot {
  readonly artifactId: ArtifactId;
  readonly revision: ArtifactRevision;
  readonly interactionRevision: ArtifactRevision;
  readonly interactionNodes: readonly InteractionNodeSnapshot[];
}

export function isArtifactLifecycleTransitionAllowed(
  from: ArtifactLifecycleState,
  to: ArtifactLifecycleState,
): boolean {
  if (from === to) return true;
  if (to === "failed") return true;

  const transitions: Readonly<Record<ArtifactLifecycleState, readonly ArtifactLifecycleState[]>> = {
    cold: ["streaming", "parsed", "live"],
    // A stream must finish before it can be painted authoritatively: going
    // straight to snapshot or live would publish an incomplete source.
    streaming: ["parsed", "cold"],
    parsed: ["cold", "snapshot", "live"],
    snapshot: ["cold", "live", "hibernated"],
    live: ["snapshot", "hibernated"],
    hibernated: ["cold", "snapshot", "live"],
    failed: ["cold"],
  };

  return transitions[from].includes(to);
}
