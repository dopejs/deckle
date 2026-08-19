# Deckle Engineering Guide

Read [`docs/design.md`](docs/design.md) before changing architecture or behavior and use
[`docs/plan.md`](docs/plan.md) for milestone order and gates. Planned capabilities must not be
described as implemented.

## Product boundary

Deckle is an infinite artifact compositor and runtime, not a general browser engine. HTML, CSS, and
controlled JavaScript are possible artifact inputs. Full Web-platform or arbitrary ReactDOM
compatibility is not assumed. New compatibility claims require fixtures and evidence.

The project must preserve these distinctions:

- A paint snapshot is not the artifact model. Durable source/state and the interaction tree remain
  separately revisioned.
- Figma-like editor selection and Web-page runtime events are different modes with explicit event
  ownership.
- Live DOM, Shadow DOM, iframe, immutable snapshot, and future canvas-native compilation are
  different capability tiers; do not silently substitute one for another.
- Browser-native HTML-in-Canvas APIs are experimental and feature-detected. They must always have an
  explicit fallback or unsupported state.
- Canvas rendering does not remove the memory or CPU cost of a retained iframe or script realm.

## Architectural invariants

- The Scene Store is authoritative for artifact identity, frame geometry, source revision,
  lifecycle, and durable state. Mounted DOM is a projection and may be destroyed.
- Artifact frame geometry is controlled by the canvas. Artifact content cannot resize its world
  frame without a validated, revisioned request.
- Paint, interaction, and durable-state revisions must be correlated. Stale snapshots and stale
  runtime messages cannot overwrite a newer artifact.
- A focused, composing, pointer-captured, or actively dragged artifact is pinned until the
  interaction ends or is explicitly cancelled.
- Snapshot mode retains enough interaction metadata for supported editor hit testing. Unsupported
  browser-native behavior requires promotion to a live tier.
- Every live DOM/iframe/runtime and GPU texture is owned by a budget manager with observable
  accounting and deterministic eviction rules.
- Generated content is untrusted. Shadow DOM is CSS encapsulation, not a script security boundary.
- Cross-artifact access is denied unless a host capability explicitly grants it.
- Camera coordinates are logical and independent of browser scroll extents. Rendering performs
  origin rebasing before numeric precision becomes visible.
- Offscreen and low-zoom artifacts do no layout, paint, or script work unless a declared background
  capability permits it.

## Package and dependency rules

- The public entry package is named `@dopejs/deckle`; every other package under `packages/` or
  `apps/` uses the `@dopejs/deckle-*` namespace.
- Extensionless relative TypeScript imports are required.
- Public contracts live in a designated contract package or generated schema; do not duplicate
  string enums, protocol numbers, or lifecycle states across packages.
- Rendering backends depend on contracts and retained scene data. Core scene, lifecycle, and
  security packages must not depend on PixiJS or another optional backend.
- Experimental-browser adapters stay behind narrow capability interfaces and feature flags.
- Avoid introducing framework-specific assumptions into the artifact model.
- If Rust is introduced, run it through `pnpm rust:check`, `pnpm rust:test`, or `pnpm rust:clippy`.
  These runners disable incremental artifacts, use the controlled `.cache/cargo-target` directory,
  and remove it in a `finally` path. Do not run bare Cargo commands that leave an unbounded
  repository `target/` tree.

## Development workflow

Before changing behavior:

1. Read the relevant design, ADR, security section, and nearby tests.
2. Verify browser/API assumptions with primary sources or an executable probe.
3. State whether the change affects source, interaction, paint, or runtime revisions.
4. Identify memory ownership and lifecycle cleanup for new DOM, runtime, worker, or GPU resources.

While changing behavior:

- Make the smallest coherent change and preserve fallback paths.
- Add metrics for new caching, lifecycle, isolation, and fallback behavior.
- Keep reference implementations for optimized spatial, hit-test, and cache paths.
- Do not hide unsupported content by rendering a misleading partial result. Produce a diagnostic.
- Treat parsers, generated HTML, runtime messages, and serialized artifacts as trust boundaries.

After changing behavior:

- Run the narrowest relevant checks, then `pnpm check` and `pnpm build`.
- Rust changes must pass the applicable repository runner; `pnpm rust:artifacts:check` must report a
  bounded footprint after the run.
- Report exact commands and results.
- For performance changes, use the benchmark protocol and comparable workloads.
- For non-trivial changes, document failure modes, containment, and rollback.

## Testing expectations

- Camera/spatial/virtualization: property tests against naive reference implementations.
- Lifecycle: deterministic transition, pinning, eviction, failure, and restoration tests.
- Interaction: nested clip/transform/paint-order fixtures plus capture/target/bubble tests.
- Browser adapters: capability detection and real-browser tests; mocks alone are insufficient.
- Security: malicious HTML/CSS/URL/message fixtures and capability denial tests.
- Performance: before/after measurements with the same browser, device profile, artifact corpus,
  zoom, viewport, warmup, samples, and percentile method.
- Cross-browser: unsupported tiers must select an intentional fallback, not crash or silently lose
  interaction.

## Documentation decisions

Update `docs/design.md` and add or amend an ADR when changing product boundaries, lifecycle,
security model, compatibility tiers, public contracts, milestone order, or acceptance gates. Record
compatibility impact, evidence, failure modes, and rollback.
