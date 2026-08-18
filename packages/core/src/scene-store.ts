import {
  isArtifactLifecycleTransitionAllowed,
  type ArtifactFrame,
  type ArtifactId,
  type ArtifactLifecycleState,
  type ArtifactMode,
  type Rect,
} from "@dopejs/canvas-protocol";
import { GridSpatialIndex, isValidRect, type SpatialIndex } from "@dopejs/canvas-spatial";
import {
  InvalidLifecycleTransitionError,
  PinnedEvictionError,
  StaleHandleError,
  StaleRevisionError,
  StaleRuntimeEpochError,
  UnknownArtifactError,
} from "./errors.js";

/** Reasons that pin an artifact against eviction (design §5.1). */
export type PinReason =
  | "focus"
  | "composition"
  | "pointer-capture"
  | "drag"
  | "background-capability"
  | "inspection"
  /** An agent is still generating this artifact; evicting it would lose the stream. */
  | "streaming";

export interface ArtifactRevisions {
  readonly sourceRevision: number;
  readonly stateRevision: number;
  readonly interactionRevision: number;
  readonly paintRevision: number;
  readonly runtimeEpoch: number;
  /**
   * Increments while a stream appends to an incomplete source. Drafts are
   * deliberately separate from `sourceRevision`: an agent emitting tokens must
   * not invalidate committed paint or interaction trees on every chunk.
   */
  readonly draftRevision: number;
  /**
   * Paint produced from a draft. It may be displayed as a placeholder but is
   * never authoritative for hit testing, and a committed paint supersedes it.
   */
  readonly provisionalPaintRevision: number;
}

export interface ArtifactFailure {
  readonly code: string;
  readonly message: string;
  readonly recoverable: boolean;
}

export interface ArtifactRecord {
  readonly id: ArtifactId;
  readonly generation: number;
  readonly frame: ArtifactFrame;
  readonly mode: ArtifactMode;
  readonly lifecycle: ArtifactLifecycleState;
  readonly revisions: ArtifactRevisions;
  readonly pins: readonly PinReason[];
  readonly failure: ArtifactFailure | null;
}

/** Generation-safe reference: stale after the artifact is removed or replaced. */
export interface ArtifactHandle {
  readonly id: ArtifactId;
  readonly generation: number;
}

const INITIAL_REVISIONS: ArtifactRevisions = {
  sourceRevision: 1,
  stateRevision: 1,
  interactionRevision: 0,
  paintRevision: 0,
  runtimeEpoch: 0,
  draftRevision: 0,
  provisionalPaintRevision: 0,
};

/** States whose entry counts as releasing live/snapshot resources. */
const EVICTION_TARGETS: ReadonlySet<ArtifactLifecycleState> = new Set(["cold", "hibernated"]);

export interface SceneTransaction {
  createArtifact(id: ArtifactId, frame: ArtifactFrame, mode?: ArtifactMode): ArtifactHandle;
  removeArtifact(handle: ArtifactHandle): void;
  setFrame(handle: ArtifactHandle, frame: ArtifactFrame): void;
  setMode(handle: ArtifactHandle, mode: ArtifactMode): void;
  transition(handle: ArtifactHandle, to: ArtifactLifecycleState): void;
  fail(handle: ArtifactHandle, failure: ArtifactFailure): void;
  pin(handle: ArtifactHandle, reason: PinReason): void;
  unpin(handle: ArtifactHandle, reason: PinReason): void;
  bumpSourceRevision(handle: ArtifactHandle): number;
  bumpStateRevision(handle: ArtifactHandle): number;
  bumpRuntimeEpoch(handle: ArtifactHandle): number;
  /** Record that a stream appended to an incomplete source. */
  bumpDraftRevision(handle: ArtifactHandle): number;
  /**
   * Publish paint rendered from a draft. Throws {@link StaleRevisionError} when
   * the draft has already moved on, so a slow render cannot overwrite a newer
   * frame of the same stream.
   */
  commitProvisionalPaint(handle: ArtifactHandle, forDraftRevision: number): number;
  /**
   * Publish an interaction tree produced against the given source/state pair.
   * Throws {@link StaleRevisionError} when the committed pair moved on.
   */
  commitInteraction(
    handle: ArtifactHandle,
    forSourceRevision: number,
    forStateRevision: number,
  ): number;
  /** Publish paint output; same staleness contract as {@link commitInteraction}. */
  commitPaint(handle: ArtifactHandle, forSourceRevision: number, forStateRevision: number): number;
  /**
   * Apply durable state reported by a live runtime. Messages from a replaced
   * runtime (stale epoch) are rejected and cannot overwrite newer state.
   */
  applyRuntimeState(handle: ArtifactHandle, runtimeEpoch: number): number;
  get(handle: ArtifactHandle): ArtifactRecord;
}

/**
 * Authoritative artifact scene. All mutation happens inside {@link transact}:
 * changes build against a draft and publish atomically on return. A thrown
 * error discards the draft and leaves the previous committed scene untouched,
 * including the spatial index.
 */
export class SceneStore {
  #committed = new Map<ArtifactId, ArtifactRecord>();
  #generations = new Map<ArtifactId, number>();
  #storeRevision = 0;
  #index: SpatialIndex;

  constructor(index: SpatialIndex = new GridSpatialIndex()) {
    this.#index = index;
  }

  get storeRevision(): number {
    return this.#storeRevision;
  }

  get size(): number {
    return this.#committed.size;
  }

  get(handle: ArtifactHandle): ArtifactRecord {
    const record = this.#resolve(this.#committed, handle);
    return record;
  }

  getById(id: ArtifactId): ArtifactRecord | undefined {
    return this.#committed.get(id);
  }

  handleOf(id: ArtifactId): ArtifactHandle {
    const record = this.#committed.get(id);
    if (!record) throw new UnknownArtifactError(id);
    return { id: record.id, generation: record.generation };
  }

  isHandleCurrent(handle: ArtifactHandle): boolean {
    const record = this.#committed.get(handle.id);
    return record !== undefined && record.generation === handle.generation;
  }

  /** Ids intersecting a world rect, via the store-owned spatial index. */
  queryFrames(rect: Rect): ArtifactId[] {
    return this.#index.queryRect(rect);
  }

  queryPoint(x: number, y: number): ArtifactId[] {
    return this.#index.queryPoint(x, y);
  }

  records(): IterableIterator<ArtifactRecord> {
    return this.#committed.values();
  }

  transact<T>(work: (tx: SceneTransaction) => T): T {
    const draft = new Map(this.#committed);
    const draftGenerations = new Map(this.#generations);
    const touchedFrames = new Map<ArtifactId, ArtifactFrame | null>();

    const resolve = (handle: ArtifactHandle): ArtifactRecord => this.#resolve(draft, handle);

    const put = (record: ArtifactRecord): void => {
      draft.set(record.id, record);
    };

    const requireValidFrame = (id: ArtifactId, frame: ArtifactFrame): void => {
      if (!isValidRect(frame) || !Number.isFinite(frame.zIndex)) {
        throw new RangeError(`Artifact "${id}" frame must be a valid rect with finite zIndex`);
      }
    };

    const tx: SceneTransaction = {
      createArtifact: (id, frame, mode = "edit") => {
        if (draft.has(id)) {
          throw new Error(`Artifact "${id}" already exists`);
        }
        requireValidFrame(id, frame);
        const generation = (draftGenerations.get(id) ?? 0) + 1;
        draftGenerations.set(id, generation);
        const record: ArtifactRecord = {
          id,
          generation,
          frame: { ...frame },
          mode,
          lifecycle: "cold",
          revisions: INITIAL_REVISIONS,
          pins: [],
          failure: null,
        };
        put(record);
        touchedFrames.set(id, record.frame);
        return { id, generation };
      },
      removeArtifact: (handle) => {
        const record = resolve(handle);
        if (record.pins.length > 0) {
          throw new PinnedEvictionError(record.id, "cold", record.pins);
        }
        draft.delete(record.id);
        touchedFrames.set(record.id, null);
      },
      setFrame: (handle, frame) => {
        const record = resolve(handle);
        requireValidFrame(record.id, frame);
        put({ ...record, frame: { ...frame } });
        touchedFrames.set(record.id, { ...frame });
      },
      setMode: (handle, mode) => {
        put({ ...resolve(handle), mode });
      },
      transition: (handle, to) => {
        const record = resolve(handle);
        if (!isArtifactLifecycleTransitionAllowed(record.lifecycle, to)) {
          throw new InvalidLifecycleTransitionError(record.id, record.lifecycle, to);
        }
        if (EVICTION_TARGETS.has(to) && record.pins.length > 0) {
          throw new PinnedEvictionError(record.id, to, record.pins);
        }
        put({ ...record, lifecycle: to, failure: to === "failed" ? record.failure : null });
      },
      fail: (handle, failure) => {
        const record = resolve(handle);
        put({ ...record, lifecycle: "failed", failure });
      },
      pin: (handle, reason) => {
        const record = resolve(handle);
        if (record.pins.includes(reason)) return;
        put({ ...record, pins: [...record.pins, reason] });
      },
      unpin: (handle, reason) => {
        const record = resolve(handle);
        put({ ...record, pins: record.pins.filter((pin) => pin !== reason) });
      },
      bumpSourceRevision: (handle) => {
        const record = resolve(handle);
        const revisions = {
          ...record.revisions,
          sourceRevision: record.revisions.sourceRevision + 1,
          // A new source generation makes any in-flight draft obsolete.
          draftRevision: 0,
        };
        put({ ...record, revisions });
        return revisions.sourceRevision;
      },
      bumpDraftRevision: (handle) => {
        const record = resolve(handle);
        const revisions = {
          ...record.revisions,
          draftRevision: record.revisions.draftRevision + 1,
        };
        put({ ...record, revisions });
        return revisions.draftRevision;
      },
      commitProvisionalPaint: (handle, forDraftRevision) => {
        const record = resolve(handle);
        if (forDraftRevision !== record.revisions.draftRevision) {
          throw new StaleRevisionError(
            record.id,
            "provisional paint",
            forDraftRevision,
            record.revisions.draftRevision,
          );
        }
        const revisions = {
          ...record.revisions,
          provisionalPaintRevision: record.revisions.provisionalPaintRevision + 1,
        };
        put({ ...record, revisions });
        return revisions.provisionalPaintRevision;
      },
      bumpStateRevision: (handle) => {
        const record = resolve(handle);
        const revisions = {
          ...record.revisions,
          stateRevision: record.revisions.stateRevision + 1,
        };
        put({ ...record, revisions });
        return revisions.stateRevision;
      },
      bumpRuntimeEpoch: (handle) => {
        const record = resolve(handle);
        const revisions = { ...record.revisions, runtimeEpoch: record.revisions.runtimeEpoch + 1 };
        put({ ...record, revisions });
        return revisions.runtimeEpoch;
      },
      commitInteraction: (handle, forSourceRevision, forStateRevision) => {
        const record = resolve(handle);
        assertFreshPair(record, forSourceRevision, forStateRevision, "interaction tree");
        const revisions = {
          ...record.revisions,
          interactionRevision: record.revisions.interactionRevision + 1,
        };
        put({ ...record, revisions });
        return revisions.interactionRevision;
      },
      commitPaint: (handle, forSourceRevision, forStateRevision) => {
        const record = resolve(handle);
        assertFreshPair(record, forSourceRevision, forStateRevision, "paint");
        const revisions = {
          ...record.revisions,
          paintRevision: record.revisions.paintRevision + 1,
          // Authoritative paint supersedes any placeholder from the stream.
          provisionalPaintRevision: 0,
        };
        put({ ...record, revisions });
        return revisions.paintRevision;
      },
      applyRuntimeState: (handle, runtimeEpoch) => {
        const record = resolve(handle);
        if (runtimeEpoch !== record.revisions.runtimeEpoch) {
          throw new StaleRuntimeEpochError(record.id, runtimeEpoch, record.revisions.runtimeEpoch);
        }
        const revisions = {
          ...record.revisions,
          stateRevision: record.revisions.stateRevision + 1,
        };
        put({ ...record, revisions });
        return revisions.stateRevision;
      },
      get: (handle) => resolve(handle),
    };

    const result = work(tx);

    // Publication point: nothing below may throw for valid drafts. Spatial
    // index updates happen only after the draft is accepted.
    this.#committed = draft;
    this.#generations = draftGenerations;
    this.#storeRevision += 1;
    for (const [id, frame] of touchedFrames) {
      if (frame === null || !draft.has(id)) {
        this.#index.delete(id);
      } else {
        this.#index.set(id, frame);
      }
    }
    return result;
  }

  #resolve(map: ReadonlyMap<ArtifactId, ArtifactRecord>, handle: ArtifactHandle): ArtifactRecord {
    const record = map.get(handle.id);
    if (!record) throw new UnknownArtifactError(handle.id);
    if (record.generation !== handle.generation) {
      throw new StaleHandleError(handle.id, handle.generation, record.generation);
    }
    return record;
  }
}

function assertFreshPair(
  record: ArtifactRecord,
  forSourceRevision: number,
  forStateRevision: number,
  kind: string,
): void {
  if (forSourceRevision !== record.revisions.sourceRevision) {
    throw new StaleRevisionError(
      record.id,
      kind,
      forSourceRevision,
      record.revisions.sourceRevision,
    );
  }
  if (forStateRevision !== record.revisions.stateRevision) {
    throw new StaleRevisionError(record.id, kind, forStateRevision, record.revisions.stateRevision);
  }
}
