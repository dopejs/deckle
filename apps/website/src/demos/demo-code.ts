export const CANVAS_DEMO_CODE = `import {
  createCamera,
  SceneStore,
  VisibilityTracker,
} from "@dopejs/deckle";

const store = new SceneStore();
store.transact((scene) => {
  scene.createArtifact("brief", {
    x: 120,
    y: 80,
    width: 320,
    height: 220,
    zIndex: 1,
  });
});

const camera = createCamera({
  x: 0,
  y: 0,
  zoom: 1,
  viewportWidth: 960,
  viewportHeight: 560,
});

const tracker = new VisibilityTracker();
const { visible, overscan } = tracker.compute(store, camera);

for (const artifactId of visible) {
  renderer.draw(store.getById(artifactId)!);
}`;

export const INTERACTION_DEMO_CODE = `import { createInteractionTree } from "@dopejs/deckle-artifact";
import {
  CachedHitTester,
  NO_SELECTION,
  resolveClick,
} from "@dopejs/deckle-editor";

const tree = createInteractionTree("brief", 1, 1, [
  {
    id: "panel",
    bounds: { x: 0, y: 0, width: 320, height: 240 },
  },
  {
    id: "button",
    parentId: "panel",
    bounds: { x: 24, y: 32, width: 140, height: 44 },
    role: "button",
  },
]);

const tester = new CachedHitTester(tree);
const hit = tester.hitTest(pointer.x, pointer.y);
const selection = resolveClick(tree, NO_SELECTION, hit?.path ?? []);

console.log(selection);`;

export const STREAMING_DEMO_CODE = `import {
  SceneStore,
  StreamCoalescer,
  StreamingIngestion,
} from "@dopejs/deckle";
import { StreamingSanitizer } from "@dopejs/deckle-security";

const store = new SceneStore();
const handle = store.transact((scene) =>
  scene.createArtifact("agent-report", {
    x: 120,
    y: 80,
    width: 360,
    height: 260,
    zIndex: 1,
  }),
);

const ingestion = new StreamingIngestion(
  store,
  handle,
  new StreamingSanitizer(),
  new StreamCoalescer({ minIntervalMs: 66, minChars: 128 }),
);

for await (const chunk of agentStream) {
  const update = ingestion.push(chunk, performance.now());
  if (update.rendered) paint(update.html);
}

const committed = ingestion.finish();
paint(committed.html);`;
