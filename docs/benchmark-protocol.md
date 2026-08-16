# Benchmark protocol

This protocol prevents attractive demos and average FPS from substituting for comparable evidence.
M0 will refine numeric budgets without changing the measurement discipline.

## 1. Required environment record

Every run records:

- repository commit and dirty state;
- production/development build mode;
- Node/pnpm and optional Rust toolchain;
- browser product, exact version, channel, command flags, origin-trial state;
- OS, device model, CPU, RAM, GPU, power/thermal state where available;
- viewport, device pixel ratio, renderer/backend, color mode;
- artifact corpus hash, profile, count, DOM complexity, resources, runtime behavior;
- capability report and selected fallback.

## 2. Canonical scenarios

### A. Camera-only interaction

- 500 logical artifacts, 50 visible at normal zoom.
- Warm caches before measurement.
- Pan, zoom, and direction-reversal trace for at least 30 seconds.
- No artifact content mutation.

### B. Low-zoom density

- 1,000 logical artifacts, 100 visible representations.
- Exercise LOD entry/exit and texture admission/eviction.

### C. Activation lifecycle

- Select cached internal nodes.
- Promote artifact to live, perform a supported edit, capture, hibernate, and restore.
- Repeat across a deterministic artifact sequence.

### D. Runtime density matrix

Run identical artifacts as plain DOM, Shadow DOM, sandbox iframe, live HTML-in-Canvas, immutable
snapshot after source removal, and selected controlled-runtime candidate at counts 1, 10, 50, 100,
and 500 where stable.

### E. Fault and churn

- Rapid viewport reversal and zoom oscillation.
- Capture failure, runtime crash, stale message, texture allocation failure, lost GPU context, and
  memory-pressure signal.
- At least 30 minutes of activation/hibernate churn for soak evidence.

## 3. Metrics

Collect distributions, not only averages:

- frame time P50/P95/P99 and missed-frame rate;
- event-to-visible-update and activation latency P50/P95/P99;
- camera, spatial query, mount, layout, capture, upload, composite, and cleanup phases;
- long tasks and main-thread blocking;
- JS heap where available, process/private memory where available, DOM nodes, iframes, workers,
  runtime contexts, and timers;
- GPU texture bytes and allocations, snapshot bytes, cache hit/admission/eviction;
- memory slope by logical, visible, and live artifact count;
- stale-revision drops, failures, and fallback selections;
- interaction hit latency and disagreement with live/reference hit testing.

The documented desktop target for continuous interaction is P95 ≤ 16.7 ms and P99 ≤ 25 ms. M0 must
establish absolute memory and activation gates before M1 exits.

## 4. Sampling

- Use a warmup excluded from samples and record its duration.
- Use at least five independent runs for engineering comparison unless the scenario specifies more.
- Preserve raw per-frame/per-event data and compute percentiles using one checked-in method.
- Randomized layouts use recorded seeds.
- Before/after comparisons use the same corpus, trace, browser, backend, build, machine, sample
  count, percentile method, and thermal/power conditions.

## 5. Correctness before speed

A run is invalid if:

- artifacts, interaction nodes, or expected pixels are missing;
- the optimized path selects a different target from the supported reference profile;
- a fallback silently drops required behavior;
- the run accumulates uncaught errors, stale authoritative revisions, or leaked pinned resources;
- content or cache was disabled solely to improve the metric.

Golden images, tolerances, workload density, and budgets are never changed solely to pass a
regression.

## 6. Evidence format

Raw reports use versioned JSON schemas introduced with M0. A summary links raw reports and states:

- hypothesis and acceptance gate;
- result and confidence/variance;
- correctness/fallback status;
- regressions and investigations;
- qualification gaps;
- decision, feature flag, and rollback.

Large evidence artifacts must not be committed until storage and retention policy are decided.
