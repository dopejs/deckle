# Open questions

These questions require M0 evidence or repository-owner decisions. They are intentionally not
resolved by the pre-development baseline.

## Product and compatibility

1. What is the first LLM artifact profile: static HTML/CSS, controlled interactions, or a narrower
   structured dialect that can emit HTML?
2. Is unchanged ReactDOM execution a future compatibility profile or explicitly outside scope?
3. Must a run-mode click enter an inactive artifact on the first gesture, or may edit mode select
   first and enter on a second gesture?
4. Which internal CSS features must preserve exact snapshot hit testing in the first release?
5. Which artifact behaviors are allowed to pause during hibernation?

## Browser and renderer

1. Does native `captureElementImage` release all meaningful source paint resources after DOM removal
   on target Chromium builds?
2. Can HTML-in-Canvas update and camera transforms meet the main-thread stall expectations of the
   product, given the proposal's current scrolling limitations?
3. Is PixiJS the initial production backend, a probe dependency, or only a reference?
4. What static fallback is acceptable on Firefox and Safari before equivalent native APIs exist?
5. How should texture resolution change across zoom without visible activation discontinuity?

## Runtime and security

1. Are generated scripts required in the first product slice?
2. Which candidate provides the required isolation and startup/memory profile: Worker plus
   capability API, SES, QuickJS/WASM, or another realm?
3. Which network/storage capabilities exist, and who grants them?
4. Can durable state be restricted to JSON-like data, or must runtime heap snapshots be supported?
5. What is the maximum number of simultaneous browser artifacts and who may override it?

## Operational decisions

1. Which OSI-approved license and governance model should the owners select?
2. What branch protection, required reviews, release signing, and provenance policies apply?
3. Which reference desktop/mobile devices and CI browser service are available?
4. Where will benchmark evidence and large deterministic artifact corpora be stored?
