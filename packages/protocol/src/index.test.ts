import { describe, expect, it } from "vitest";
// Streaming-specific lifecycle expectations live alongside the existing ones.

import { isArtifactLifecycleTransitionAllowed } from "./index";

describe("isArtifactLifecycleTransitionAllowed", () => {
  it("allows a live artifact to become a snapshot", () => {
    expect(isArtifactLifecycleTransitionAllowed("live", "snapshot")).toBe(true);
  });

  it("does not let a cold artifact pretend it already has a snapshot", () => {
    expect(isArtifactLifecycleTransitionAllowed("cold", "snapshot")).toBe(false);
  });

  it("allows every state to fail without inventing a recovery path", () => {
    expect(isArtifactLifecycleTransitionAllowed("parsed", "failed")).toBe(true);
    expect(isArtifactLifecycleTransitionAllowed("failed", "live")).toBe(false);
  });
});

describe("streaming lifecycle", () => {
  it("should allow a cold artifact to start streaming", () => {
    expect(isArtifactLifecycleTransitionAllowed("cold", "streaming")).toBe(true);
  });

  it("should require a stream to finish before it can be painted authoritatively", () => {
    expect(isArtifactLifecycleTransitionAllowed("streaming", "parsed")).toBe(true);
    expect(isArtifactLifecycleTransitionAllowed("streaming", "snapshot")).toBe(false);
    expect(isArtifactLifecycleTransitionAllowed("streaming", "live")).toBe(false);
    expect(isArtifactLifecycleTransitionAllowed("streaming", "hibernated")).toBe(false);
  });

  it("should allow abandoning or failing a stream", () => {
    expect(isArtifactLifecycleTransitionAllowed("streaming", "cold")).toBe(true);
    expect(isArtifactLifecycleTransitionAllowed("streaming", "failed")).toBe(true);
  });

  it("should not let a completed artifact fall back into streaming", () => {
    for (const from of ["parsed", "snapshot", "live", "hibernated"] as const) {
      expect(isArtifactLifecycleTransitionAllowed(from, "streaming")).toBe(false);
    }
  });
});
