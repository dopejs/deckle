# dope-canvas delivery plan

> Status: pre-development draft v0.1  
> Basis: [`design.md`](design.md)  
> Scheduling: dependency order and evidence gates; no staffing or calendar estimate

## 1. Delivery principles

- Prove browser capabilities, lifecycle economics, and interaction correctness before building a
  broad editor or compatibility layer.
- Keep one executable vertical slice from logical artifact through render, hit test, activation,
  hibernation, and restoration.
- Treat live DOM, iframe, script realm, GPU texture, and parsed document memory as budgeted
  resources.
- Do not claim arbitrary HTML/React/Web compatibility. Every profile needs fixtures and a support
  matrix.
- Keep experimental browser and renderer integrations removable behind adapters.
- Define absolute performance and memory gates from reproducible M0 evidence before M1 exits.

## 2. Workstreams

| Workstream               | Scope                                                      | Evidence                       |
| ------------------------ | ---------------------------------------------------------- | ------------------------------ |
| W1 Architecture          | contracts, ADRs, threat model, support matrix              | reviewed documents and gates   |
| W2 Canvas core           | camera, scene store, spatial index, virtualizer            | property/differential tests    |
| W3 HTML bridge           | live DOM, ElementImage, fallback, capture                  | real-browser contract fixtures |
| W4 Artifact model        | source, revisions, interaction tree, serialization         | deterministic round trips      |
| W5 Runtime/security      | capabilities, messages, quotas, hibernation                | hostile-input and fault tests  |
| W6 Editor                | internal selection, hierarchy, transforms, input promotion | semantic E2E fixtures          |
| W7 Rendering/performance | backend, pictures, LOD, budgets, metrics                   | comparable benchmark reports   |

## 3. P0 — pre-development baseline

P0 establishes the repository and prevents architectural assumptions from becoming accidental code.

### Deliverables

- [x] Empty remote cloned and monorepo baseline created.
- [x] Node/pnpm/toolchain versions and repository commands defined.
- [x] `@dopejs/canvas-*` package-name rule enforced.
- [x] Design, plan, security, compatibility, benchmark, and open-question documents.
- [x] Initial ADRs for product boundary, HTML strategy, lifecycle, and naming.
- [x] CI, formatting, linting, type checking, unit test, docs-link, and package-name gates.
- [x] Minimal private protocol vocabulary; no claim of a stable public API.
- [x] Cargo output policy and cleanup runner prepared before any Rust workspace exists.
- [ ] Open-source license selected by repository owners.
- [ ] CODEOWNERS and branch-protection policy configured in GitHub.

### Exit gate

`pnpm check` and `pnpm build` pass from a clean install. Documentation has no broken local links.
The remaining owner-controlled GitHub tasks stay visible and do not block starting M0 probes.

## 4. M0 — feasibility and measurement probes

M0 answers whether the proposed browser/runtime path is viable. Probe code is disposable and must
not become the production API by inertia.

### 4.1 Native HTML-in-Canvas contract

- Detect `layoutsubtree`, `paint`, `drawElementImage`, WebGL/WebGPU equivalents,
  `captureElementImage`, transferability, and failure modes.
- Verify direct-child, sizing, clip, transform, device-pixel-ratio, focus, selection, form,
  accessibility, find-in-page, and update timing semantics.
- Confirm whether an immutable ElementImage remains valid after source DOM destruction.
- Measure capture, upload, repaint, resize, and texture memory by artifact size and DOM complexity.
- Record exact browser build, flags/origin trial, GPU, OS, and API shape.

### 4.2 Runtime and isolation economics

Run the same artifact corpus as:

1. plain DOM subtree;
2. Shadow DOM subtree;
3. same-origin sandbox iframe;
4. live HTML-in-Canvas texture;
5. immutable snapshot after DOM removal;
6. controlled-runtime candidate without browser DOM.

Measure memory slope, style/layout/paint, long tasks, activation, steady state, teardown, and leak
behavior at 1, 10, 50, 100, and 500 artifacts where the platform remains stable.

### 4.3 Infinite-canvas and interaction probes

- Camera and origin-rebase precision across extreme logical coordinates.
- Naive scan versus candidate spatial index at target distributions.
- 500 logical/50 visible and 1,000 logical/100 low-LOD workloads.
- Capture internal geometry with stable IDs; compare retained hit results with live DOM hit results.
- Exercise nested transforms, clips, overlap, pointer-events, scrolling, and paint order.
- Demonstrate edit selection from a cached picture without a live DOM subtree.
- Demonstrate activation and restoration without losing source/state revision.

### 4.4 Fallback probes

- Chromium with experimental API enabled and disabled.
- Current stable Chromium, Firefox, and Safari.
- DOM overlay correctness and density.
- Static representation choices when native ElementImage is unavailable.
- Typed diagnostics for unsupported content.

### 4.5 M0 decisions and gate

M0 exits only after ADRs record:

- selected live and snapshot path per supported platform;
- whether PixiJS is the initial backend or only a reference integration;
- interaction-tree extraction profile and unsupported CSS behavior;
- controlled-runtime candidate and browser-artifact escape hatch;
- absolute memory, activation, and frame-time gates for M1/M2;
- retained fallback and rollback paths.

The gate is automated probe collection plus a signed evidence manifest. A demo video or manual
impression is not sufficient.

## 5. M1 — deterministic infinite-canvas core

### Deliverables

- Scene Store with generation-safe artifact handles and revision transactions.
- Camera, screen/world transforms, origin rebasing, and deterministic input trace.
- Naive spatial oracle plus selected optimized index.
- Visible, overscan, pinned, warm, and cold sets.
- Lifecycle state machine and explicit resource budgets.
- Backend-neutral retained picture interface and one reference renderer.
- Metrics and trace export from the first vertical slice.

### Gate

- Property/differential tests pass with shrinking and replayable seeds.
- Camera-only pan/zoom does not rebuild artifact content.
- Target scenario meets the absolute M0 frame-time and memory gates.
- Faulted allocation leaves the prior committed scene usable.

## 6. M2 — artifact capture, snapshot, and restoration

### Deliverables

- Validated static artifact profile and deterministic artifact corpus.
- Live browser adapter selected by M0.
- Immutable snapshot/picture ownership and texture budget.
- Revision-safe `live → snapshot → hibernated → live` transactions.
- LOD selection and snapshot-resolution policy.
- Capability detection and at least one correctness-first fallback.
- Leak detection and repeated lifecycle soak.

### Gate

- Repeated activation/hibernate cycles retain durable state and release owned resources.
- Stale capture/runtime messages cannot overwrite a newer revision.
- Focused, composing, captured, or dragged artifacts are never evicted.
- Fallback fixtures preserve documented behavior or return a typed unsupported result.
- Memory plateaus under the lifecycle soak within the M0 gate.

## 7. M3 — internal interaction and editor selection

### Deliverables

- Stable internal node IDs and versioned interaction-tree format.
- Nested transform/clip/paint-order hit testing with a naive oracle.
- Edit-mode artifact selection, hierarchy entry, deep selection, and escape-to-parent.
- Selection bounds, resize/move handles, snapping hooks, and overlay rendering.
- Capture/target/bubble virtual-event path for the controlled artifact profile.
- Semantic automation selectors and debug visualization.

### Gate

- Cached artifacts support internal selection without live DOM.
- Live DOM and retained interaction-tree hit results agree for the supported fixture profile.
- Unsupported native interactions promote to live or report a diagnostic; no false event target.
- Interaction latency meets the M0 gate at the target visible-node density.

## 8. M4 — controlled runtime and native input promotion

### Deliverables

- Capability-based runtime with no ambient host DOM or network authority.
- Versioned state/event/message protocol, quotas, cancellation, and runtime epochs.
- Deterministic hibernation and restoration for the supported state profile.
- Live promotion for input, text selection, IME, and documented browser-native controls.
- Secure browser-artifact iframe escape hatch with strict concurrent budget.
- Malicious-input corpus and operator-facing failure diagnostics.

### Gate

- Static and controlled artifacts require no iframe.
- Cross-artifact, host DOM, storage, navigation, popup, and ungranted network access are denied.
- Runtime crash, timeout, message flood, and stale epoch do not corrupt the Scene Store.
- Composition and focus pinning pass recorded browser/OS fixtures.

## 9. M5 — production hardening and ecosystem

### Deliverables

- Public package/API review and stable compatibility profiles.
- Devtools for lifecycle, budgets, texture memory, interaction, revisions, and fallback reasons.
- Lost context, memory pressure, worker/runtime crash, and capture failure recovery.
- Accessibility projection and semantic E2E coverage for snapshot/canvas tiers.
- Import/export format, migration rules, and version negotiation.
- Browser/device qualification matrix, soak reports, and release runbooks.
- Optional renderer adapters proven through conformance fixtures.

### Gate

- Repository-wide correctness, security, performance, compatibility, and soak gates pass.
- Every support claim names the exact compatibility profile and platform tier.
- Rollback drills succeed for experimental browser API, runtime, LOD, and renderer backends.
- An OSI-approved license, governance, security reporting process, and release provenance exist.

## 10. Dependency order

```text
P0 baseline
  → M0 evidence
    → M1 deterministic canvas core
      → M2 snapshot lifecycle
        → M3 retained interaction
          → M4 controlled runtime/input
            → M5 production/ecosystem
```

Allowed parallel work:

- Security fixtures may advance with M0, but policy must not assume an unselected runtime.
- Interaction fixture authoring may advance with M2, but the public format waits for lifecycle
  revisions to settle.
- Editor visual exploration may proceed as disposable prototypes, not production packages.
- Optional Rust probes may start only with a measured hotspot and must use repository cleanup
  runners.

## 11. Risks and containment

| Risk                           | Failure                             | Containment                                                |
| ------------------------------ | ----------------------------------- | ---------------------------------------------------------- |
| Browser API changes            | integration breaks between versions | narrow adapter, capability report, feature flag            |
| Non-Chromium gap               | no native snapshot/live path        | DOM fallback, typed tier, no false support claim           |
| iframe memory                  | active set exceeds budget           | pin-aware cap, hibernate/reject, measure slope             |
| DOM snapshot loses interaction | wrong internal target               | retained tree, live comparison, promote/diagnose           |
| CSS complexity                 | incorrect bounds/paint order        | supported profile, fixtures, reject unsupported cases      |
| Runtime escape                 | host or user data compromised       | capabilities, quotas, sandbox, hostile corpus              |
| Activation jank                | first interaction misses frame      | overscan/prewarm, trace phases, explicit editor gesture    |
| Texture memory                 | GPU loss or process termination     | byte budget, LOD, eviction, lost-context recovery          |
| State divergence               | stale runtime overwrites edits      | revision/epoch checks and transactional commit             |
| Rust target growth             | developer disk exhaustion           | controlled target, non-incremental runner, finally cleanup |

## 12. Release evidence

Every milestone report contains:

- exact commit and dirty status;
- toolchain, browser, flags, OS, hardware/GPU, and backend;
- fixture corpus version and content profile;
- commands and raw evidence locations;
- correctness failures and exclusions;
- P50/P95/P99 methodology and samples;
- memory slope and cleanup evidence;
- selected fallback and rollback test;
- qualification gaps that remain visible.
