# ADR 0002: Treat browser HTML-in-Canvas as an experimental adapter

- Status: accepted for M0
- Date: 2026-08-16
- Owners: repository owners

## Context

Chromium is experimenting with DOM descendants of a `layoutsubtree` canvas being rendered to 2D,
WebGL, or WebGPU and captured as transferable ElementImage snapshots. PixiJS v8.19 exposes this as
live `HTMLSource` and immutable `ElementImageSource`. The proposal is not a stable cross-browser
baseline and live DOM/iframe cost remains.

## Decision

Build M0 probes behind a narrow capability adapter. Never make the Scene Store, artifact model, or
security policy depend on PixiJS or a specific experimental API shape. Preserve a correctness-first
fallback and a typed unsupported state.

## Alternatives

- **Depend directly on PixiJS types throughout core:** faster demo, locks core lifecycle to a
  renderer and experimental API.
- **Implement a full HTML renderer first:** avoids browser dependency but delays validation of the
  lifecycle product hypothesis.
- **Use html2canvas as semantic baseline:** incomplete and unsuitable as a correctness oracle for
  arbitrary CSS/browser behavior.

## Evidence

- [WICG explainer](https://wicg.github.io/html-in-canvas/)
- [Chrome origin-trial article](https://developer.chrome.com/blog/html-in-canvas-origin-trial)
- [PixiJS v8.19 announcement](https://pixijs.com/blog/june-2026)

## Consequences

The first probe is Chromium-specific. Support claims require exact API and browser qualification.
PixiJS can be an adapter or reference implementation without owning project contracts.

## Failure modes

API removal/change, missing non-Chromium implementation, cross-origin restrictions, main-thread
scroll/update cost, source resource retention, and snapshot/interaction mismatch.

## Rollback

Disable the adapter and select DOM overlay, backend-specific static representation, or explicit
unsupported result. Persisted artifact source/state remains independent.

## Verification

Real-browser contract probes, disabled-feature fallback, memory/capture measurements, and repeated
source-destroy/snapshot-use tests.
