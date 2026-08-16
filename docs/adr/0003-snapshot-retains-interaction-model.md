# ADR 0003: Snapshot paint without flattening interaction

- Status: accepted
- Date: 2026-08-16
- Owners: repository owners

## Context

Immutable textures make dense infinite canvases feasible, but an image alone cannot identify the
internal element a user intends to select or activate. The product requires Figma-like internal
selection even when the artifact is not live.

## Decision

Every supported snapshot correlates paint output with a retained interaction-tree revision. Artifact
source/state and stable internal identity remain authoritative. Snapshot is a cache, not a
serialization format for the whole artifact.

## Alternatives

- **Page-level hit only:** simpler but fails internal selection.
- **Keep live DOM solely for hit testing:** preserves browser behavior but retains the memory cost
  the product is intended to avoid.
- **Activate on every pointer before hit testing:** adds latency, can lose the first gesture, and
  causes lifecycle churn.

## Consequences

Supported CSS/geometry must be representable in the interaction tree and tested against a live or
naive reference. Unsupported native interactions promote to live or return a diagnostic.

## Failure modes

Paint and interaction revisions diverge; complex stacking/clip behavior produces a false target;
stale geometry is used after content changes.

## Rollback

Disable snapshot interaction for affected profiles and require live promotion. Never silently use an
approximate target for a compatibility claim.

## Verification

Nested transform, clip, overlap, pointer-events, and paint-order fixtures; differential hit tests;
stale revision and activation fallback tests.
