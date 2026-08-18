# dope-canvas technical design

> Status: pre-development draft v0.1  
> Date: 2026-08-16  
> Product: infinite canvas runtime for AI-generated Web artifacts

This document is the technical source of truth for the initial probes and implementation plan. A
section describing a planned subsystem is not evidence that the subsystem exists. Current delivery
status is tracked in [`plan.md`](plan.md).

## 1. Problem and product position

An AI canvas may contain hundreds or thousands of artifacts that originate as independent HTML, CSS,
and JavaScript pages. Keeping every artifact mounted as an iframe retains a browsing context,
DOM/CSS state, script realm, resources, and rendering state per page. Flattening every artifact to
an image reduces live cost but loses internal selection, event targeting, accessibility, and
stateful reactivation.

dope-canvas owns the space between those extremes:

```text
Artifact = source + durable state + interaction tree + paint cache + optional live runtime
```

It is an artifact compositor and lifecycle runtime. It is not initially a full browser engine, a
general CSS implementation, or a promise that arbitrary sites and ReactDOM applications run
unchanged.

### 1.1 Goals

1. Maintain a responsive infinite canvas with hundreds of logical artifacts.
2. Make mounted DOM, iframe, runtime, and GPU resources proportional to the active viewport and
   interaction set rather than total document count.
3. Preserve Figma-like selection of internal artifact nodes when paint is cached as a texture.
4. Promote artifacts to a live browser or controlled runtime tier only when required.
5. Support LLM-generated content through explicit profiles, validation, diagnostics, revisioning,
   and capability controls.
6. Preserve native text, form, accessibility, and browser integrations where a supported live tier
   provides them.
7. Keep renderer, browser adapter, and runtime choices replaceable behind measured contracts.

### 1.2 Non-goals for the initial release

- Full HTML, CSS, DOM, Web API, or ReactDOM compatibility.
- Rendering arbitrary cross-origin sites into readable Canvas textures.
- Keeping every artifact's JavaScript, timers, media, and network connections permanently live.
- Treating Shadow DOM as a security boundary.
- Pixel-perfect import of arbitrary external pages.
- Collaboration, multiplayer conflict resolution, or a business document model.
- A new general-purpose game engine.

## 2. Product semantics

### 2.1 Artifact frame ownership

The canvas owns each artifact's world-space frame `(x, y, width, height, z)`. HTML content lays out
inside that frame. Content may request a frame change, but only a validated, revisioned host
transaction can commit it. This prevents content resize feedback from invalidating spatial
virtualization.

### 2.2 Edit and run modes

The same pointer gesture has two distinct meanings:

- **Edit mode:** hit testing selects an artifact or an internal interaction node. dope-canvas owns
  the gesture, handles, hierarchy entry, and transforms.
- **Run mode:** hit testing routes an event to the artifact runtime. Browser-native semantics are
  only promised for a live tier that provides them.

Mode switching is explicit. Pointer capture cannot transfer silently between canvas and artifact
runtime during a gesture.

### 2.3 Paint cache is not the model

An immutable image or GPU texture is one revision of paint output. It never replaces:

- artifact source and durable state;
- stable internal node identity;
- parent/child relationships;
- interaction bounds, clips, paint order, and supported actions;
- accessibility metadata;
- the revision that correlated those structures.

This invariant enables cached rendering and internal hit testing at the same time.

## 3. Architecture overview

```text
LLM / import / authoring
          │
          ▼
┌────────────────────────────────────────────────────────────┐
│ Artifact ingestion                                         │
│ parse · sanitize · resource policy · profile validation    │
└──────────────────────────┬─────────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────────┐
│ Scene Store                                                │
│ world frames · source revisions · durable state · mode     │
│ lifecycle · capabilities · failures                        │
└──────────────┬───────────────────┬─────────────────────────┘
               │                   │
               ▼                   ▼
┌──────────────────────────┐  ┌──────────────────────────────┐
│ Camera / spatial index   │  │ Artifact document model      │
│ viewport · LOD · culling │  │ nodes · styles · interaction │
└──────────────┬───────────┘  └───────────────┬──────────────┘
               │                              │
               └──────────────┬───────────────┘
                              ▼
┌────────────────────────────────────────────────────────────┐
│ Lifecycle and budget manager                               │
│ cold · parsed · snapshot · live · hibernated · failed      │
└───────────┬───────────────────┬────────────────────────────┘
            │                   │
            ▼                   ▼
┌────────────────────────┐  ┌────────────────────────────────┐
│ Browser HTML adapter   │  │ Controlled runtime             │
│ live DOM · snapshot    │  │ events · state · capabilities  │
│ iframe fallback        │  │ optional isolated JS contexts  │
└───────────┬────────────┘  └────────────────┬───────────────┘
            └──────────────────┬─────────────┘
                               ▼
┌────────────────────────────────────────────────────────────┐
│ Retained renderer                                          │
│ pictures/textures · tiles · LOD · composition · overlays   │
└──────────────────────────┬─────────────────────────────────┘
                           ▼
                  Canvas2D / WebGL / WebGPU
```

### 3.1 Dependency direction

Scene, lifecycle, interaction, and security contracts are backend-independent. Browser adapters and
PixiJS or future doper integrations depend on those contracts, never the reverse. Generated content
cannot import host internals.

## 4. Authoritative data and revisions

Each artifact has correlated but independently produced revisions:

```ts
interface ArtifactRecord {
  sourceRevision: number;
  stateRevision: number;
  interactionRevision: number;
  paintRevision: number;
  runtimeEpoch: number;
  draftRevision: number;
  provisionalPaintRevision: number;
}
```

- `sourceRevision` changes when HTML/CSS/script or structured source changes.
- `stateRevision` changes with durable artifact state.
- `interactionRevision` identifies geometry and event metadata derived from a source/state pair.
- `paintRevision` identifies the image or DisplayList derived from the same pair.
- `runtimeEpoch` changes whenever a live runtime is replaced, preventing late messages from an old
  runtime from mutating a restored artifact.
- `draftRevision` changes while a generator appends to an incomplete source. Drafts are deliberately
  separate from `sourceRevision` so a token stream does not invalidate committed paint and
  interaction trees on every chunk.
- `provisionalPaintRevision` identifies paint derived from a draft. It may be displayed while the
  source is still arriving, is never authoritative for hit testing, and is superseded by the first
  committed `paintRevision`.

A paint result can only become current when its input revisions match the Scene Store. A stale
snapshot may remain as a temporary visual placeholder but is marked stale and cannot contribute
authoritative hit testing.

## 5. Camera, coordinates, and spatial virtualization

The world uses logical floating-point coordinates independent of browser scroll dimensions:

```ts
interface Camera {
  x: number;
  y: number;
  zoom: number;
  viewportWidth: number;
  viewportHeight: number;
}
```

The camera transforms screen coordinates to a world viewport. A spatial index returns visible and
overscan artifacts. A naive scan remains available as a differential oracle.

The renderer rebases local origins when large world coordinates would reduce transform or text
precision. Rebase changes rendering coordinates, not logical artifact positions.

### 5.1 Visibility sets

- `visible`: intersects the current world viewport.
- `overscan`: expected to enter soon based on direction and velocity.
- `pinned`: focus, composition, pointer capture, drag, explicit background capability, or active
  inspection prevents eviction.
- `warm`: recently visible and retained within budget.
- `cold`: source/state only; no layout, runtime, or GPU allocation.

Visibility is necessary but not sufficient for activation. Low zoom may show many visible artifacts
as low-resolution cached pictures without creating live DOM.

## 6. Artifact lifecycle

```text
        ┌─ streaming ─┐        ┌──────────── failure ────────────┐
        ▼             │        ▼                                 │
cold ───┴──────→ parsed → snapshot ⇄ live → hibernated ─────────┘
  ▲                │          │         │          │
  └────────────────┴──────────┴─────────┴──────────┘
```

- `cold`: validated source, durable state, and coarse metadata only.
- `loading`: the artifact exists on the canvas with nothing renderable yet — a generation before its
  first committed character, or media that has not decoded. Every artifact passes through it, so "no
  content yet" is a state the renderer handles rather than an empty frame that looks broken.
- `streaming`: a generator is still producing the source. Only the safe prefix is rendered, paint is
  provisional, and no authoritative interaction tree exists yet.
- `parsed`: document/interaction source is available without live execution.
- `snapshot`: immutable paint cache plus correlated interaction tree.
- `live`: DOM or controlled runtime is mounted and accepts supported events.
- `hibernated`: runtime state is serialized; runtime resources are released.
- `failed`: a typed failure is visible and recoverable; the last safe snapshot may remain.

Transitions are transactions. Allocation happens before publication. Failure leaves the previous
committed state usable. Eviction never destroys a pinned artifact.

### 6.1 Streaming ingestion

An agent emits an artifact token by token, so the canvas must show progress from a source that is
incomplete by definition. Rendering a raw prefix is unsafe: `<scr` may become `<script>`, an
unterminated `<style>` hides its own content from the tokenizer, and a half-written attribute can
still become an event handler.

Ingestion therefore renders only the **committed prefix** — the longest prefix whose meaning no
continuation can change. Everything after the boundary is withheld until more arrives, and the
boundary never moves backwards: a reader is never shown an interpretation that is later retracted.

Every artifact kind streams differently, so each carries its own segmentation rule while sharing one
streaming engine:

| Kind       | Committed up to                  | Withheld because                                   |
| ---------- | -------------------------------- | -------------------------------------------------- |
| `text`     | the last complete grapheme       | a split surrogate pair or dangling joiner          |
| `code`     | the last complete line           | highlighting is line-oriented and would re-run     |
| `rows`     | the last terminated row          | a row without its terminator has no meaning        |
| `markdown` | the last closed construct        | open fence, unclosed link, dangling emphasis       |
| `json`     | the last completed value         | a number can gain digits, a string can gain text   |
| `html`     | the last decided tag or text run | partial tag, unterminated raw text, partial entity |

`image` and `video` are deliberately absent from that table. Media is atomic: no prefix of the bytes
is a smaller picture, so there is nothing to segment and nothing provisional to paint. Those kinds
go `loading → parsed` on decode or `loading → failed`, reserving their box from the intrinsic aspect
ratio so the layout does not jump when the real dimensions arrive. Decoding stays with the host —
the engine holds no DOM and no codecs — which reports transfer progress, resolution, or failure
while the engine owns the lifecycle, the pin, and the revision.

Every kind carries three presentations, not one: content, loading, and failed. A frame with no
content and no loading state reads as a broken artifact rather than a pending one, and an error with
no presentation is an error nobody can act on — so failures show their message alongside the typed
code that identifies them.

Segmentation decides _what is stable_; turning the committed prefix into something displayable —
sanitizing HTML, closing open JSON structures so partial data parses, laying out markdown — is a
separate step, so a kind can change how it renders without changing what counts as stable.

For `html` the rule is also a safety boundary, and the guarantee there is stability rather than
acceptance: a malformed construct is rejected at any length, but the verdict for bytes inside the
boundary never changes as the stream continues.

Streaming artifacts observe the same transactional rules as everything else:

- transitions are `cold → streaming → parsed`; reaching `snapshot` or `live` requires a completed
  source, so an incomplete document can never be published as authoritative paint;
- the artifact is pinned for the duration, because evicting it would discard the only copy of an
  in-flight generation;
- chunks are coalesced into render ticks by time and volume — token-rate repainting is a cost, not a
  feature — and each tick publishes a provisional paint keyed to the current draft revision, so a
  slow render cannot overwrite a newer frame;
- source-byte quotas are enforced while streaming rather than at the end, so a runaway generator is
  cut off instead of buffered without bound;
- a rejected, aborted, or timed-out stream fails the artifact, releases the pin, and leaves the last
  provisional frame visible as a placeholder.

Scene growth is itself streamed: an agent announces new artifacts while earlier ones are still
filling, so frames appear on the canvas, enter the spatial index, and participate in visibility sets
and hit testing before their content is complete.

Byte-level transport concerns stay outside the engine: callers decode to text (for example with a
streaming `TextDecoder`) before appending, so chunk boundaries never split a UTF-8 sequence.

### 6.2 Resource budgets

The host accounts for at least:

- live DOM element count and retained subtree estimate;
- active iframe count and memory estimate where available;
- runtime heap, workers, timers, and background CPU;
- GPU texture bytes, render targets, and snapshot count;
- parsed document and interaction-tree bytes;
- activation latency and eviction churn.

Initial numeric defaults are selected only after M0 measurements. Until then, tests configure
budgets explicitly rather than relying on hidden constants.

## 7. HTML rendering strategy

### 7.1 Native HTML-in-Canvas tier

Chromium's experimental HTML-in-Canvas proposal adds `layoutsubtree`, `drawElementImage`, WebGL and
WebGPU texture equivalents, a `paint` event, and `captureElementImage`. Canvas children continue to
participate in browser layout, hit testing, and accessibility while their rendered output can be
drawn into a canvas. The proposal is experimental and currently Chromium-specific:

- [WICG explainer](https://wicg.github.io/html-in-canvas/)
- [Chrome origin-trial article](https://developer.chrome.com/blog/html-in-canvas-origin-trial)
- [PixiJS v8.19 HTMLSource announcement](https://pixijs.com/blog/june-2026)

The adapter treats this API as a capability, not a baseline. Live DOM remains real DOM and still
incurs layout, script, and resource cost. A live iframe still incurs its browsing-context cost.
Mirroring it into a texture does not make it lightweight.

### 7.2 Immutable snapshot tier

Where `captureElementImage` is available, an artifact can produce an immutable image that outlives
the source element and may be transferred for worker rendering. Snapshot capture is revisioned.
After capture, the lifecycle manager may release live DOM/runtime resources if the artifact is not
pinned.

An immutable snapshot does not retain browser-native events. dope-canvas separately retains an
interaction tree for supported editor selection and virtual-runtime events.

### 7.3 DOM overlay fallback

When native HTML-in-Canvas is unavailable, a bounded live DOM overlay may preserve correctness for
active artifacts. It is not expected to meet the same density or composition capabilities. The
selected fallback and its limitations are observable.

### 7.4 Canvas-native content profile

A controlled content profile compiles directly to retained scene primitives instead of a DOM
subtree. This removes live DOM cost for common generated artifacts but is a separate compatibility
tier, not an implicit partial rendering of arbitrary HTML.

A first profile is implemented. Content compiles to a display list of positioned text runs and
rules:

- markdown — headings, paragraphs, list items, emphasis, inline code, links, fenced code;
- the sanitized HTML subset — the same constructs plus tables, so an artifact renders as headings
  and emphasis rather than as visible markup;
- code and JSON — syntax-highlighted lines, with JSON formatted;
- rows — a table with aligned columns and a header rule;
- text — wrapped prose.

Layout is pure and text measurement is injected, so geometry is identical in a browser, a worker,
and a test. Layout depends on content and frame width only; zoom is a transform, which is what keeps
camera movement from rebuilding content. Anything outside the supported constructs degrades to plain
text rather than being approximated.

What this profile is not: an HTML or CSS engine. Arbitrary layout, positioning, floats, flexbox,
media, and scripted content remain the live-tier question that M0 evidence must answer. Extending
the profile requires extending its fixtures and, where a live tier exists, a differential oracle
against it.

## 8. Interaction tree and hit testing

The interaction tree is a compact retained projection of supported internal artifact nodes:

```ts
interface InteractionNode {
  id: string;
  parentId: string | null;
  bounds: Rect;
  transform: Matrix;
  clip?: Clip;
  paintOrder: number;
  pointerEvents: "auto" | "none";
  role?: string;
  actionIds?: readonly string[];
}
```

Pointer routing is:

```text
screen coordinate
  → inverse camera transform
  → artifact spatial hit
  → inverse artifact transform
  → interaction BVH / paint-order resolution
  → edit selection OR capture/target/bubble event path
```

Nested clips, transforms, pointer-events, visibility, paint order, and frame clipping are part of
correctness. The optimized index is differentially tested against a naive traversal.

Browser DOM extraction does not automatically produce a durable hit tree. A browser-backed capture
adapter must assign stable IDs and extract supported geometry before releasing the DOM. If exact
behavior cannot be represented, the artifact must remain live or report that the interaction is
unsupported in snapshot mode.

## 9. Runtime and event model

Three runtime profiles are planned:

1. **Static:** no artifact script; editor selection and host-declared actions only.
2. **Controlled:** isolated script context with capability-based state, events, timers, fetch, and
   virtual document mutations.
3. **Browser:** sandboxed iframe or equivalent for compatibility; strictly budgeted and normally
   active only while required.

Shadow DOM may scope CSS for live same-document content. It does not isolate malicious script.
Controlled runtime APIs deny ambient host DOM, storage, network, navigation, and cross-artifact
access unless capabilities grant them.

Editor events and runtime events are never both owners of the same initial pointer event. Run-mode
events use capture, target, and bubble phases within one artifact. Cross-artifact bubbling stops at
the artifact frame unless the host defines a separate canvas event.

## 10. Input, focus, and editing

Focus, pointer capture, text selection, and IME composition pin an artifact. A lifecycle transition
that would remove the active input host is deferred until commit/cancel.

Initial implementation may promote an artifact to live DOM for browser-native input. A later
canvas-native text editor must define UTF-16, UTF-8, grapheme, shaping cluster, glyph, caret, and
selection mappings before replacing the browser path.

Activation must avoid losing the triggering gesture:

- edit mode may use first click to select and a subsequent gesture to enter/run;
- run mode may prewarm on pointer proximity;
- synthetic replay is only allowed for explicitly supported virtual actions and must not be
  represented as a trusted browser event.

## 11. Rendering and level of detail

The compositor operates on retained pictures/textures rather than repainting every artifact every
frame. Camera-only movement updates transforms and visible sets. Content changes invalidate the
smallest owned picture or tile compatible with correctness.

Suggested LOD policy, subject to M0 evidence:

- high zoom: live or full-resolution snapshot with internal interaction;
- medium zoom: full snapshot with deferred live activation;
- low zoom: lower-resolution snapshot and semantic interaction targets;
- very low zoom: title, color, outline, or cluster representation.

Texture allocation is bounded and observable. Eviction considers recency, visibility, pinning,
recreation cost, resolution, and bytes. Cache admission must reject artifacts that exceed per-item
or global budgets.

## 12. Security and trust boundaries

Generated content, imported documents, runtime messages, URLs, serialized states, image/font
resources, and browser snapshots are untrusted. The normative policy is in
[`security.md`](security.md).

Minimum rules:

- sanitize HTML even when scripts are disabled;
- deny executable inline handlers in static artifacts;
- scope or validate CSS that can affect host layout or cause pathological resource use;
- allowlist resource schemes and network capabilities;
- sandbox browser artifacts without same-origin, navigation, popup, download, camera, microphone,
  clipboard, or storage authority by default;
- version and validate every runtime message;
- cap source bytes, DOM nodes, selector complexity, decoded image dimensions, font bytes, state
  bytes, timers, messages, and texture dimensions;
- redact secrets and password content from logs, snapshots, recordings, and devtools.

## 13. Accessibility and automation

Live native HTML may participate in the browser accessibility tree when supported. Snapshot and
canvas-native tiers need a host semantic projection correlated with the interaction revision.
Offscreen artifacts remain searchable through the Scene Store rather than mounted DOM.

Editor automation targets stable artifact and interaction IDs. Pixel coordinates alone are not a
stable automation contract.

## 14. Capability and fallback model

Feature detection produces a recorded capability report. The intended order is:

1. Native HTML-in-Canvas live source and immutable snapshot, if proven safe and supported.
2. Backend-specific live/snapshot implementation with equivalent verified behavior.
3. Bounded DOM overlay for active artifacts plus available static representation.
4. Typed unsupported state for content that cannot be rendered safely or correctly.

No fallback may silently execute with broader authority. No platform support claim is made from a
feature flag, origin trial, mocked method, or one browser version.

## 15. Intended package boundaries

Only `@dopejs/canvas-protocol` exists in the pre-development baseline. The following names describe
intended boundaries and are not implemented packages:

| Package                        | Responsibility                                           |
| ------------------------------ | -------------------------------------------------------- |
| `@dopejs/canvas-core`          | scene store, camera, lifecycle orchestration             |
| `@dopejs/canvas-spatial`       | spatial indexes and reference implementations            |
| `@dopejs/canvas-artifact`      | source, revisions, document and interaction model        |
| `@dopejs/canvas-html-source`   | native HTML-in-Canvas and fallback adapters              |
| `@dopejs/canvas-runtime`       | controlled runtime and event routing                     |
| `@dopejs/canvas-security`      | sanitization, policies, capabilities, quotas             |
| `@dopejs/canvas-renderer`      | backend-neutral retained picture contract                |
| `@dopejs/canvas-renderer-pixi` | optional PixiJS backend adapter                          |
| `@dopejs/canvas-editor`        | selection, hierarchy navigation, transforms, overlays    |
| `@dopejs/canvas-devtools`      | lifecycle, cache, memory, event and fallback diagnostics |

Applications and private probes also use the `@dopejs/canvas-*` namespace.

## 16. Optional Rust boundary and disk budget

Rust is not selected or implemented in this baseline. If evidence justifies Rust/WASM for spatial,
layout, parsing, or retained rendering hot paths, it must preserve backend-neutral contracts and a
TypeScript reference path until differential validation is mature.

Cargo build output is deliberately bounded. Repository scripts direct output to
`.cache/cargo-target`, disable incremental artifacts, and remove the directory after check, test, or
clippy runs. `pnpm rust:artifacts:check` rejects more than 256 MiB of residual Cargo artifacts. Bare
Cargo commands that leave an unbounded `target/` tree are not part of the supported workflow.

## 17. Observability

Per frame and over rolling windows, record:

- frame phases and P50/P95/P99;
- camera update, spatial query, mount, capture, upload, and composite time;
- visible, overscan, warm, pinned, live, snapshot, hibernated, and failed counts;
- DOM nodes, live iframes, runtime contexts, workers, timers, and background tasks;
- CPU heap where measurable, GPU texture bytes, cache hit/eviction/admission counts;
- activation latency, snapshot age, stale-revision drops, restoration failures;
- interaction hits, misses, fallback-to-live count, and event dispatch latency;
- selected capability tier and reason.

Metrics must avoid artifact source, user text, secrets, and generated code by default.

## 18. Performance and acceptance framework

Initial product scenarios are:

- 500 logical artifacts with 50 visible;
- 1,000 logical artifacts at low zoom with 100 visible representations;
- no more than three explicitly pinned live browser artifacts in the default scenario;
- nested internal hit testing on cached artifacts;
- continuous pan/zoom and rapid direction reversal;
- activation, edit, snapshot, hibernate, and restore cycles.

The target on the documented desktop reference profile is P95 frame time at or below 16.7 ms and P99
at or below 25 ms during continuous interaction. Memory and activation budgets are not fixed until
M0 establishes valid measurement methods and distributions; they must become absolute gates before
M1 completion. Full methodology is in [`benchmark-protocol.md`](benchmark-protocol.md).

Average FPS is diagnostic only. Correctness, tail latency, memory slope, long-task count, and
fallback behavior decide acceptance.

## 19. Testing strategy

1. **Unit:** revisions, lifecycle, budgets, coordinates, policies.
2. **Property:** spatial query, transforms, hit testing, eviction, transaction ordering.
3. **Differential:** optimized versus naive spatial/hit/cache implementations.
4. **Browser contract:** real layoutsubtree/live/snapshot/focus/accessibility behavior.
5. **Security:** hostile HTML/CSS/URL/message/state corpora.
6. **Visual:** deterministic fixtures across paint revisions and backends.
7. **End-to-end:** selection, activation, input, hibernation, restoration, and fallback.
8. **Performance:** fixed artifact corpus, viewport, zoom trace, browser/device, and percentile
   method.
9. **Soak/fault:** repeated lifecycle churn, memory pressure, worker/runtime crash, lost GPU
   context, stale messages, and capture failure.

## 20. Failure containment and rollback

- Experimental HTML-in-Canvas remains feature-flagged and can fall back to DOM overlay or an
  explicit unsupported result.
- PixiJS is an optional backend; the artifact/lifecycle model does not depend on it.
- Controlled JS runtime can be disabled without disabling static artifacts.
- Browser artifacts have a strict live budget and can be hibernated or rejected.
- New LOD, cache, runtime, and renderer paths ship behind independent flags with reference paths.
- A failed new revision leaves the previous committed snapshot and interaction tree available when
  safe.

Milestone implementation and exit gates are defined in [`plan.md`](plan.md).
