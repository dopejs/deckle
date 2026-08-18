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

/**
 * Content kinds an agent can produce. Each kind streams differently, so each
 * carries its own rule for when received bytes stop being provisional.
 */
export type ArtifactKind = "text" | "markdown" | "code" | "json" | "rows" | "html";

/**
 * Result of segmenting a growing buffer: how much is stable, and why the tail
 * is withheld.
 *
 * "Stable" means no continuation of the stream can change how the committed
 * characters are interpreted — a half-written markdown link, an unterminated
 * code fence, an object with no closing brace, and a partial HTML tag all stay
 * outside the boundary. Rendering only the committed prefix is what keeps a
 * streaming artifact from flickering between wrong and right interpretations.
 */
export interface StreamSlice {
  /** Characters from the start of the buffer that are stable. */
  readonly committedLength: number;
  /** Why the remainder is withheld, or null when the whole buffer is stable. */
  readonly pending: string | null;
}

/**
 * Pure segmentation rule for one artifact kind. Segmentation decides *what is
 * stable*; turning the committed prefix into something displayable (sanitizing
 * HTML, parsing JSON, laying out markdown) is a separate step.
 */
export type StreamSegmenter = (buffer: string) => StreamSlice;

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
