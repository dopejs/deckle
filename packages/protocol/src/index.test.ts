import { describe, expect, it } from "vitest";

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
