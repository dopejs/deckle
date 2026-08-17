# Changelog

## v0.1.0 — 2026-08-17

First tagged pre-release. Packages remain private (not published to npm) until the repository owners
select a license; this tag marks the tested engine-contract baseline.

### Engine packages

- **@dopejs/canvas-spatial** — grid spatial index with bounded oversize handling plus a linear-scan
  oracle, differentially tested with seeded replayable workloads.
- **@dopejs/canvas-core** — camera with anchor-stable zoom and origin rebasing; Scene Store with
  generation-safe handles, atomic transactions, and fault rollback; lifecycle state machine with
  pin-aware eviction guards; visible/overscan/warm/cold/pinned visibility sets; explicit resource
  budget ledger; P50/P95/P99 metrics recorder; deterministic replayable input traces.
- **@dopejs/canvas-artifact** — correlated revision model, versioned interaction-tree format with
  validation and normalization, canonical JSON serialization, hibernation records.
- **@dopejs/canvas-security** — static-profile HTML sanitizer (re-serializing, fail-closed), URL
  scheme allowlist resistant to control-character smuggling, explicit quotas, deterministic rate
  limiter, closed-world capability sets. Verified against a hostile-input corpus.
- **@dopejs/canvas-runtime** — versioned runtime↔host message protocol, epoch-based stale-message
  rejection, capability-guarded host bridge with cancellation and timer quotas.
- **@dopejs/canvas-renderer** — backend-neutral retained picture contract with a leak-detecting
  reference backend, byte-budgeted pin-aware LRU texture cache, LOD and snapshot-resolution
  policies, reference compositor (camera-only movement reuses retained pictures).
- **@dopejs/canvas-editor** — nested transform/clip/paint-order hit testing (cached tester
  differentially tested against a naive oracle), Figma-style progressive selection with deep select
  and escape-to-parent, capture/target/bubble virtual event paths.
- **@dopejs/canvas-protocol** — shared pre-release vocabulary.

### Applications

- **@dopejs/canvas-platform-probe** — fail-closed HTML-in-Canvas capability detection and signed
  evidence manifests; simulated environments can never satisfy the M0 gate.
- **@dopejs/canvas-playground** — Storybook demos: infinite canvas (HiDPI rendering, native trackpad
  pan/pinch-zoom semantics), hit testing, sanitizer, LOD & texture cache.
- **@dopejs/canvas-website** — project site at https://canvas.dopejs.com/ with in-site Usage and
  Design docs and the playground as a deep-linkable sub-route.

### Verification

- 214 automated tests across 14 suites: unit, property, differential-vs-oracle, hostile-input, and
  churn/leak soak.
- `pnpm check` gates formatting, linting, types, tests, doc links, package naming, and Cargo
  artifact hygiene; CI runs the same gates plus builds on every push.

### Known boundaries

- Real-browser M0 probes (experimental HTML-in-Canvas APIs, performance/memory evidence) are not run
  yet; support remains a detected capability, not a claim.
- No open-source license selected; CODEOWNERS/branch protection pending (owner decisions).
- Absolute performance and memory gates are deliberately unset until M0 measurements exist.
