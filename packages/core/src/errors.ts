import type { ArtifactLifecycleState } from "@dopejs/deckle-protocol";

export class UnknownArtifactError extends Error {
  constructor(id: string) {
    super(`Artifact "${id}" does not exist in the committed scene`);
    this.name = "UnknownArtifactError";
  }
}

export class StaleHandleError extends Error {
  constructor(id: string, handleGeneration: number, currentGeneration: number) {
    super(
      `Handle for artifact "${id}" has generation ${handleGeneration} but the ` +
        `current generation is ${currentGeneration}`,
    );
    this.name = "StaleHandleError";
  }
}

export class InvalidLifecycleTransitionError extends Error {
  constructor(id: string, from: ArtifactLifecycleState, to: ArtifactLifecycleState) {
    super(`Artifact "${id}" cannot transition from "${from}" to "${to}"`);
    this.name = "InvalidLifecycleTransitionError";
  }
}

export class PinnedEvictionError extends Error {
  constructor(id: string, to: ArtifactLifecycleState, pins: readonly string[]) {
    super(`Artifact "${id}" is pinned (${pins.join(", ")}) and cannot be evicted to "${to}"`);
    this.name = "PinnedEvictionError";
  }
}

export class StaleRevisionError extends Error {
  constructor(id: string, kind: string, expected: number, actual: number) {
    super(
      `Stale ${kind} for artifact "${id}": produced against revision ${expected} ` +
        `but the committed revision is ${actual}`,
    );
    this.name = "StaleRevisionError";
  }
}

export class StaleRuntimeEpochError extends Error {
  constructor(id: string, messageEpoch: number, currentEpoch: number) {
    super(
      `Runtime message for artifact "${id}" carries epoch ${messageEpoch} but the ` +
        `current runtime epoch is ${currentEpoch}`,
    );
    this.name = "StaleRuntimeEpochError";
  }
}
