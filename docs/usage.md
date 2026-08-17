# Using dope-canvas

> The packages are pre-release (`0.0.0`, private) and are not yet published to a registry. Until a
> first release is cut, consume them from a checkout of this repository — for example through a pnpm
> workspace or `pnpm link`. Every API below is real and covered by the repository test suite; the
> public surface may still change before release.

## Install

```bash
git clone https://github.com/dopejs/dope-canvas.git
cd dope-canvas
pnpm install --frozen-lockfile
pnpm check   # 200+ tests, lint, types
```

Add the packages you need to your workspace:

```jsonc
// package.json
{
  "dependencies": {
    "@dopejs/canvas-core": "workspace:*",
    "@dopejs/canvas-spatial": "workspace:*",
    "@dopejs/canvas-security": "workspace:*",
  },
}
```

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
