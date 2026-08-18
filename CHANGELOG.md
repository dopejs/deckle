# Changelog

## Unreleased

- Published to npm. The libraries are Apache-2.0 and live under `@dopejs/canvas-*`, built from the
  v0.2.0 tree with npm provenance attesting the GitHub Actions build. Installing is now ordinary:
  `pnpm add @dopejs/canvas-core`.

## v0.2.0 — 2026-08-18

Streaming becomes a first-class property of the node model, every kind renders as itself on the
canvas, and the project site ships in 11 languages. Packages remain private pending license
selection.

- Each node kind now _renders_ rather than showing its source. A canvas-native display list
  (`@dopejs/canvas-renderer`) compiles markdown, the sanitized HTML subset, code, JSON, rows, and
  text into positioned text runs and rules: headings and emphasis, syntax highlighting, formatted
  JSON, and tables with aligned columns and a header rule. Layout is pure with injected text
  measurement, and depends on content and frame width only — zoom is a transform, so camera movement
  never rebuilds content. This is the canvas-native profile from design §7.4, not an HTML engine;
  unsupported constructs degrade to plain text.

- Streaming is a property of the node model, not an HTML feature. `StreamSlice`/`StreamSegmenter`
  (`@dopejs/canvas-protocol`) define one contract; `@dopejs/canvas-artifact` implements it for text
  (grapheme-safe), code and rows (whole lines), markdown (closed constructs only), and JSON (value
  boundaries, with `completeJsonPrefix` repairing the prefix so partial data parses), while the HTML
  safe prefix conforms to the same shape. `createSegmentedPort` (`@dopejs/canvas-core`) drives any
  kind through one ingestion engine. A property test caught a real defect where a markdown boundary
  retreated when a third backtick turned committed text into a fence; boundaries are now monotonic
  by test. A Canvas Stream story shows six kinds streaming into frames on the live canvas while the
  agent keeps announcing new nodes.

- Streaming rendering for agent-generated artifacts. `computeSafePrefix` and `StreamingSanitizer`
  (`@dopejs/canvas-security`) render only the part of a growing buffer whose parse no continuation
  can change, withholding partial tags, unterminated raw-text elements, incomplete character
  references, and split surrogate pairs; source quotas are enforced while streaming. A new
  `streaming` lifecycle state plus `draftRevision`/`provisionalPaintRevision`
  (`@dopejs/canvas-protocol`, `@dopejs/canvas-core`) keep provisional paint out of authoritative hit
  testing, pin artifacts against eviction mid-generation, and commit exactly one source revision on
  completion. `StreamCoalescer` and `StreamingIngestion` turn a token stream into budgeted render
  ticks. A Streaming story in the playground shows the safety boundary live.

- README and the project site gained a Streaming section; the site's package matrix now reflects
  canvas-native content rendering.

- Website is localized into 11 languages (English, 简体中文, 繁體中文, Español, Français, Deutsch,
  Русский, עברית, العربية, 日本語, 한국어). Each locale is a real static route (`/ja/`,
  `/ar/docs/usage/`, …) generated at build time with the correct `lang`/`dir`, translated copy,
  `hreflang` alternates, and a header language switcher. Right-to-left locales get logical-property
  layout; state diagrams stay left-to-right because their labels are English identifiers. The
  technical documents remain English with a localized notice.

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
