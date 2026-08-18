/**
 * Initial vocabulary shared by feasibility probes. This is not yet a stable public protocol;
 * M0 evidence may change it before the first release.
 */

export const PROTOCOL_VERSION = 0 as const;

export type ArtifactId = string;
export type ArtifactRevision = number;
export type InteractionNodeId = string;

/**
 * `loading` covers artifacts that exist on the canvas with nothing renderable
 * yet: a generation that has not produced its first committed character, or
 * media that has not decoded. Every artifact passes through it, so "no content
 * yet" is a state the renderer must handle rather than an empty frame that
 * looks broken.
 *
 * `streaming` covers artifacts an agent is still generating once some content
 * is renderable: the source is an incomplete but growing prefix, so paint from
 * it is provisional and no authoritative interaction tree exists yet. Atomic
 * kinds skip it entirely and go straight from `loading` to `parsed`.
 */
export type ArtifactLifecycleState =
  "cold" | "loading" | "streaming" | "parsed" | "snapshot" | "live" | "hibernated" | "failed";

export type ArtifactMode = "edit" | "run";

/**
 * Content kinds an agent can produce. Each kind streams differently, so each
 * carries its own rule for when received bytes stop being provisional.
 */
export type ArtifactKind =
  | "text"
  | "markdown"
  | "code"
  | "json"
  | "rows"
  | "html"
  /** Atomic media: no partial content exists, only loading, ready, or failed. */
  | "image"
  | "video";

/** True for kinds whose content arrives incrementally and can be segmented. */
export function isStreamableKind(kind: ArtifactKind): boolean {
  return kind !== "image" && kind !== "video";
}

/** Intrinsic media dimensions, reported by the host once decoding succeeds. */
export interface MediaMetadata {
  readonly width: number;
  readonly height: number;
  /** Video only; omitted for stills. */
  readonly durationMs?: number;
}

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
    // Content that has to be fetched or generated enters through `loading`;
    // `parsed` stays reachable for sources already in hand, such as a bundle
    // restored from storage.
    cold: ["loading", "parsed", "live"],
    // Atomic media resolves straight to `parsed`; generated content passes
    // through `streaming` once its first characters are renderable.
    loading: ["streaming", "parsed", "cold"],
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
