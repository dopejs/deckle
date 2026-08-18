# Using dope-canvas

> Pre-release (`0.2.0`). Nothing here is a stable public contract yet.

## Install

The packages are not on npm yet, so there is no supported way to add them to another project. When
they are published, installing will be ordinary:

```bash
pnpm add @dopejs/canvas-core
```

What is blocking publication is a license: the repository has not selected one, and shipping code
without a license would leave you with no right to use it. That decision is tracked in
[the plan](plan.md).

In the meantime you can [try the engine in the playground](https://canvas.dopejs.com/playground/) —
it runs these packages in the browser with nothing to install — or clone the repository and work
against the source.

The API below is real and covered by the repository test suite. The public surface may still change
before the first release.

## Scene and camera

The Scene Store owns every artifact's world frame. All mutation happens inside a transaction: a
thrown error discards the draft and the previously committed scene — including the spatial index —
stays untouched.

```ts
import { SceneStore, createCamera, panCamera, zoomCameraAt } from "@dopejs/canvas-core";

const store = new SceneStore();
const handle = store.transact((tx) =>
  tx.createArtifact("report-1", { x: 0, y: 0, width: 640, height: 480, zIndex: 0 }),
);

// Camera: world point at the viewport center, zoom in px per world unit.
let camera = createCamera({ x: 0, y: 0, zoom: 1, viewportWidth: 1280, viewportHeight: 800 });
camera = panCamera(camera, 120, -40); // drag by screen-space delta
camera = zoomCameraAt(camera, { x: 640, y: 400 }, 1.25); // anchor-stable zoom

store.queryPoint(320, 240); // → ["report-1"] via the spatial index
```

## Visibility sets and budgets

Resources follow the viewport. `VisibilityTracker` classifies artifacts into `visible`, `overscan`,
`warm`, `cold`, and `pinned`; `BudgetLedger` is the admission gate in front of any allocation.

```ts
import { BudgetLedger, VisibilityTracker } from "@dopejs/canvas-core";

const sets = new VisibilityTracker().compute(store, camera);
// sets.visible → mount or keep live; sets.cold → release resources

const budgets = new BudgetLedger({
  maxLiveArtifacts: 3,
  maxLiveDomNodes: 5_000,
  maxIframes: 1,
  maxGpuTextureBytes: 256 * 1024 * 1024,
  maxSnapshotCount: 128,
  maxParsedBytes: 8 * 1024 * 1024,
  maxRuntimeContexts: 4,
});
const decision = budgets.tryReserve({ maxLiveArtifacts: 1, maxGpuTextureBytes: 4_000_000 });
if (!decision.admitted) {
  // decision.dimension names the violated budget — surface it, don't allocate.
}
```

## Lifecycle and revisions

Artifacts move through `cold → parsed → snapshot ⇄ live → hibernated`, with `failed` reachable from
anywhere. Paint and interaction trees only commit when produced against the current source/state
pair, and messages from a replaced runtime are rejected by epoch.

```ts
store.transact((tx) => {
  tx.transition(handle, "parsed");
  tx.transition(handle, "snapshot");
  tx.commitPaint(handle, 1, 1); // throws StaleRevisionError if source/state moved on
  tx.pin(handle, "focus"); // pinned artifacts can never be evicted
});
```

## Sanitizing generated HTML

Untrusted HTML goes through the static-profile sanitizer before it is ever parsed for real. Output
is re-serialized from allowlisted parts only; anything unparseable is rejected with a typed reason
instead of guessed at.

```ts
import { sanitizeHtml } from "@dopejs/canvas-security";

const result = sanitizeHtml('<section onclick="alert(1)"><h1>Hi</h1></section>');
if (result.ok) {
  result.html; // '<section><h1>Hi</h1></section>'
  result.diagnostics; // [{ code: "dropped-attribute", detail: "section@onclick" }]
} else {
  result.reason; // "unparseable" | "quota-exceeded", with a typed violation
}
```

## Streaming any node kind

An agent emits more than HTML: prose, markdown, code, JSON, and tabular rows all arrive
incrementally, and each has its own idea of when received characters stop being provisional. A
segmenter answers that question per kind; one engine drives them all.

```ts
import { jsonSegmenter, completeJsonPrefix, markdownSegmenter } from "@dopejs/canvas-artifact";
import { createSegmentedPort, StreamingIngestion } from "@dopejs/canvas-core";

// JSON commits at value boundaries; closing the open structures keeps the
// partial result parseable while the rest is still arriving.
const jsonPort = createSegmentedPort({
  segmenter: jsonSegmenter,
  render: (committed) => (committed ? completeJsonPrefix(committed) : ""),
  maxChars: 64_000,
});

// Markdown commits at closed constructs, so an unterminated fence or a
// half-written link never renders as prose and then reflows.
const markdownPort = createSegmentedPort({ segmenter: markdownSegmenter });

const ingestion = new StreamingIngestion(store, handle, jsonPort);
```

Boundaries by kind:

| Segmenter           | Commits up to                    | Typical `pending`  |
| ------------------- | -------------------------------- | ------------------ |
| `textSegmenter`     | the last complete grapheme       | `surrogate`        |
| `codeSegmenter`     | the last complete line           | `partial-line`     |
| `rowsSegmenter`     | the last terminated row          | `partial-line`     |
| `markdownSegmenter` | the last closed construct        | `open-fence`       |
| `jsonSegmenter`     | the last completed value         | `incomplete-value` |
| `htmlSegmenter`     | the last decided tag or text run | `rawtext:script`   |

Every segmenter guarantees the boundary only moves forward, so a reader never sees an interpretation
get retracted.

## Streaming an HTML artifact from an agent

An agent produces HTML token by token. `StreamingSanitizer` renders only the part of the buffer
whose parse is already decided, so a half-written tag or an unterminated `<script>` never reaches a
renderer; `StreamingIngestion` moves the artifact through the `streaming` lifecycle state, pins it
so it cannot be evicted mid-generation, and commits exactly one source revision at the end.

```ts
import { SceneStore, StreamCoalescer, StreamingIngestion } from "@dopejs/canvas-core";
import { StreamingSanitizer } from "@dopejs/canvas-security";

const store = new SceneStore();
const handle = store.transact((tx) =>
  tx.createArtifact("agent-report", { x: 0, y: 0, width: 640, height: 480, zIndex: 0 }),
);

const sanitizer = new StreamingSanitizer();
const ingestion = new StreamingIngestion(
  store,
  handle,
  sanitizer,
  new StreamCoalescer({ minIntervalMs: 66, minChars: 512 }),
);

for await (const token of agentResponse) {
  const tick = ingestion.push(token, performance.now());
  if (tick.rendered) render(tick.html); // safe prefix only
  if (tick.status === "rejected") break; // quota or malformed source
}

const final = ingestion.finish(); // commits sourceRevision, artifact becomes "parsed"
render(final.html);
```

Inspect the boundary directly when you need to explain what is being withheld:

```ts
import { computeSafePrefix } from "@dopejs/canvas-security";

computeSafePrefix('<p>done</p><div class="ca');
// → { length: 11, pending: "open-tag" }
computeSafePrefix("<p>done</p><script>steal()");
// → { length: 11, pending: "rawtext:script" }
```

Abandon a stream that stalls or is cancelled — the artifact fails, the pin is released, and the last
provisional frame stays visible as a placeholder:

```ts
ingestion.abort("agent timed out");
```

## Hit testing cached artifacts

An interaction tree keeps internal selection working when paint is just a cached texture. The
optimized tester is differentially validated against a naive oracle, which also remains available as
a rollback path.

```ts
import { createInteractionTree } from "@dopejs/canvas-artifact";
import { CachedHitTester, resolveClick, NO_SELECTION } from "@dopejs/canvas-editor";

const tree = createInteractionTree("report-1", 1, 1, [
  { id: "root", bounds: { x: 0, y: 0, width: 640, height: 480 } },
  { id: "chart", parentId: "root", bounds: { x: 40, y: 40, width: 320, height: 240 } },
]);

const hit = new CachedHitTester(tree).hitTest(120, 90); // { nodeId: "chart", path: [...] }
const selection = resolveClick(tree, NO_SELECTION, hit?.path ?? []); // Figma-style refinement
```

## Retained pictures and the texture budget

```ts
import { ReferencePictureBackend, TextureCache, selectLod } from "@dopejs/canvas-renderer";

const cache = new TextureCache(new ReferencePictureBackend(), {
  maxTotalBytes: 64 * 1024 * 1024,
  maxItemBytes: 8 * 1024 * 1024,
});
cache.pin("report-1"); // pinned entries are never evicted
selectLod(camera.zoom); // "live-or-full" | "full-snapshot" | "reduced-snapshot" | "placeholder"
```

## What is deliberately not here yet

- A DOM/browser adapter that mounts live artifacts (M0 browser evidence pending).
- Published npm packages and semver guarantees.
- Absolute performance and memory gate numbers — they are set from M0 measurements, not invented.

See the [technical design](design.md) for the full architecture and the [delivery plan](plan.md) for
gate status.
