## Problem

<!-- What user or engineering problem does this solve? -->

## Change

<!-- What changed, and which milestone/design invariant does it affect? -->

## Verification

<!-- Exact commands, fixtures, browsers/devices, and results. -->

## Risk and rollback

<!-- Compatibility, security, resource ownership, failure modes, feature flag, and rollback. -->

## Checklist

- [ ] I did not describe planned behavior as implemented.
- [ ] New packages use `@dopejs/deckle` for the entry package or the `@dopejs/deckle-*` namespace
      for all other packages.
- [ ] Experimental browser behavior has capability detection and an explicit fallback.
- [ ] New DOM/runtime/worker/GPU resources have ownership, metrics, and cleanup.
- [ ] Rust commands, if applicable, ran through the repository pnpm wrappers.
