# Security model

> Status: pre-development policy. Implementation and independent review are future milestone work.

LLM-generated and imported artifacts are untrusted even when created from a trusted prompt or model.
Rendering success is never an authorization signal.

## 1. Assets and principals

Protect:

- host DOM, application state, authentication tokens, storage, and network authority;
- other artifacts and their source/state;
- user input, clipboard, files, media devices, and private text;
- browser/process availability, memory, CPU, GPU, disk, and network budgets;
- export integrity, revision history, and audit evidence.

Principals are the host application, user, artifact source, artifact runtime, external resource,
renderer/browser adapter, and persistence service. Authority never flows between them by accident.

## 2. Trust boundaries

Validate at every boundary:

```text
LLM/import → ingestion
source → parser/sanitizer
CSS/resources → browser or compiler
artifact runtime ↔ host message protocol
runtime → network/storage capability
live DOM → snapshot/interaction extraction
serialized state → restoration
renderer → GPU allocation
```

## 3. Artifact profiles

### Static

- No scripts or executable event attributes.
- URLs pass scheme, origin, type, byte, and redirect policy.
- CSS cannot escape its artifact frame or mutate host selectors.
- Host actions are declarations resolved against an allowlist.

### Controlled runtime

- No ambient `window`, host `document`, host storage, or unrestricted fetch.
- Capabilities are explicit, narrow, revocable, logged, and artifact-scoped.
- Messages are schema/version checked and bound to artifact ID, revision, and runtime epoch.
- CPU, heap, timers, messages, source, state, and output are quota controlled.

### Browser artifact

- Sandboxed iframe is the default compatibility boundary.
- Do not grant `allow-same-origin`, navigation, popup, download, forms, pointer lock, storage,
  clipboard, camera, microphone, geolocation, or network authority by default.
- Required permissions are granted individually with visible product policy.
- Browser artifacts remain subject to a strict concurrency and memory budget.

Shadow DOM only scopes DOM/CSS. It does not isolate script, network, storage, prototype mutation, or
host globals.

## 4. Content policy

The ingestion pipeline applies:

1. source byte and encoding limits;
2. parse with no script execution;
3. element, attribute, CSS, URL, and resource policy;
4. stable internal ID assignment;
5. compatibility-profile validation;
6. structured diagnostics for removed or unsupported behavior;
7. immutable source revision creation.

Reject or contain denial-of-service patterns including excessive node/depth counts, selector
complexity, huge dimensions, filter/shadow expansion, recursive resources, image decompression
bombs, font bombs, unbounded animation, message floods, and allocation churn.

## 5. Runtime protocol

Every message includes:

```ts
interface RuntimeEnvelope {
  protocolVersion: number;
  artifactId: string;
  sourceRevision: number;
  stateRevision: number;
  runtimeEpoch: number;
  sequence: number;
  kind: string;
  payload: unknown;
}
```

The receiver validates the envelope and payload before mutation. Sequence, revision, and epoch
checks reject duplicate, reordered, and stale messages. A malformed message cannot partially mutate
durable state.

## 6. Snapshot and interaction integrity

- Paint and interaction outputs identify their input revisions.
- A stale or failed interaction extraction cannot be paired with new pixels as authoritative.
- A snapshot from one artifact cannot be attached to another without explicit immutable sharing
  metadata.
- External and password-like content is redacted from logs and recordings.
- Export and persistence verify artifact ownership and revision.

## 7. Resource containment

Budgets cover source bytes, parsed nodes, depth, stylesheets, selectors, decoded images, fonts,
runtime heap/CPU, timers, messages, DOM nodes, live iframes, texture dimensions/bytes, snapshots,
and activation frequency.

Exhaustion produces a typed artifact failure or lower LOD. It must not trigger broad host eviction,
infinite retry, or a more privileged fallback.

## 8. Logging and privacy

Default telemetry records counts, timings, hashes, revisions, and reason codes—not HTML, scripts,
prompts, user text, URLs with credentials, runtime state, or pixels. Debug capture requires explicit
user action, retention controls, and redaction.

## 9. Security verification

Required test corpora include:

- XSS elements/attributes, malformed markup, namespace confusion, and encoding tricks;
- CSS host escape, expensive selectors/effects, remote fonts/images, and huge geometry;
- URL schemes, redirects, credential leakage, and cross-origin resources;
- capability forgery, replay, stale epoch, oversized/deep messages, and floods;
- sandbox navigation/popup/download/storage/device access attempts;
- state and snapshot substitution across artifacts;
- renderer allocation and decompression bombs.

Before a public release, establish a private vulnerability reporting channel, response SLA,
supported-version policy, dependency scanning, release provenance, and independent threat review.
