#!/usr/bin/env node
/**
 * Prove the library packages are consumable from outside this workspace.
 *
 * The workspace resolves `@dopejs/deckle-*` to TypeScript source, which hides a
 * whole class of packaging defects: a build that emits only declarations, an
 * `exports` map pointing at `src`, a missing `files` entry, or a `workspace:*`
 * dependency that never gets rewritten. None of those fail any in-repo test,
 * and all of them make `pnpm add` useless for a third party.
 *
 * So: pack every library, install the tarballs into a throwaway project outside
 * the repo, and run real imports there.
 *
 * Requires `pnpm build` first. Run with `pnpm packages:smoke`.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const LIBRARIES = [
  "protocol",
  "spatial",
  "core",
  "artifact",
  "security",
  "runtime",
  "renderer",
  "editor",
];

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

const failures = [];

// 1. Static contract: published artifacts must be built JavaScript, not source.
for (const library of LIBRARIES) {
  const directory = join(repoRoot, "packages", library);
  const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
  const published = manifest.publishConfig;

  if (published?.exports?.["."]?.default !== "./dist/index.js") {
    failures.push(`${manifest.name}: publishConfig.exports must resolve to ./dist/index.js`);
  }
  if (
    published?.types !== "./dist/index.d.ts" &&
    published?.exports?.["."]?.types !== "./dist/index.d.ts"
  ) {
    failures.push(`${manifest.name}: publishConfig must expose ./dist/index.d.ts`);
  }
  if (!manifest.files?.includes("dist")) {
    failures.push(`${manifest.name}: "files" must include dist`);
  }
  for (const path of ["dist/index.js", "dist/index.d.ts"]) {
    if (!existsSync(join(directory, path))) {
      failures.push(`${manifest.name}: missing ${path} — run pnpm build first`);
    }
  }
}

if (failures.length > 0) {
  console.error("Package consumability problems:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

// 2. Behavioural contract: pack, install elsewhere, import for real.
const workspace = mkdtempSync(join(tmpdir(), "deckle-consumer-"));
const tarballs = join(workspace, "tarballs");
try {
  const overrides = {};
  const dependencies = {};
  for (const library of LIBRARIES) {
    const directory = join(repoRoot, "packages", library);
    const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
    run("pnpm", ["pack", "--pack-destination", tarballs], directory);
    const file = join(
      tarballs,
      `${manifest.name.replace("@", "").replace("/", "-")}-${manifest.version}.tgz`,
    );
    if (!existsSync(file)) {
      throw new Error(`pnpm pack did not produce ${file}`);
    }
    // Apache-2.0 requires recipients to receive the license, and npm only ships
    // files inside the package directory — the repository root copy would not.
    const contents = run("tar", ["-tzf", file]);
    for (const required of ["package/LICENSE", "package/README.md", "package/dist/index.js"]) {
      if (!contents.includes(required)) {
        throw new Error(`${manifest.name}: tarball is missing ${required}`);
      }
    }
    // Transitive dependencies resolve to the registry unless overridden, and
    // nothing is published yet, so point every name at its local tarball.
    overrides[manifest.name] = `file:${file}`;
    dependencies[manifest.name] = `file:${file}`;
  }

  const consumer = join(workspace, "consumer");
  run("mkdir", ["-p", consumer], workspace);
  writeFileSync(
    join(consumer, "package.json"),
    `${JSON.stringify(
      { name: "consumer-smoke", private: true, type: "module", dependencies, pnpm: { overrides } },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(consumer, "smoke.mjs"),
    `import { SceneStore, createCamera, VisibilityTracker, StreamCoalescer, StreamingIngestion, createSegmentedPort } from "@dopejs/deckle";
import { markdownSegmenter } from "@dopejs/deckle-artifact";
import { sanitizeHtml } from "@dopejs/deckle-security";
import { compileMarkdown, layoutBlocks } from "@dopejs/deckle-renderer";
import { NaiveHitTester } from "@dopejs/deckle-editor";
import { validateRuntimeMessage } from "@dopejs/deckle-runtime";
import { GridSpatialIndex } from "@dopejs/deckle-spatial";
import { PROTOCOL_VERSION } from "@dopejs/deckle-protocol";

const store = new SceneStore();
const handle = store.transact((tx) =>
  tx.createArtifact("a", { x: 0, y: 0, width: 300, height: 200, zIndex: 0 }),
);
const camera = createCamera({ x: 0, y: 0, zoom: 1, viewportWidth: 800, viewportHeight: 600 });
if (new VisibilityTracker().compute(store, camera).visible.length !== 1) throw new Error("visibility");

const port = createSegmentedPort({ segmenter: markdownSegmenter });
const ingestion = new StreamingIngestion(store, handle, port, new StreamCoalescer({ minIntervalMs: 0, minChars: 1 }));
ingestion.push("Body **bold** and an open [link](htt", 0);
if (ingestion.html.includes("[link]")) throw new Error("streaming boundary did not withhold the open link");
if (store.get(handle).lifecycle !== "streaming") throw new Error("lifecycle");
ingestion.finish();

if (sanitizeHtml('<p onclick="x()">hi</p>').html !== "<p>hi</p>") throw new Error("sanitizer");
if (layoutBlocks(compileMarkdown("## H"), { width: 200, measure: (t, s) => t.length * s.size }).runs.length === 0) {
  throw new Error("layout");
}
if (typeof NaiveHitTester !== "function") throw new Error("editor");
if (validateRuntimeMessage(null).valid !== false) throw new Error("runtime");
if (new GridSpatialIndex().size !== 0) throw new Error("spatial");
if (typeof PROTOCOL_VERSION !== "number") throw new Error("protocol");

console.log("consumer smoke passed");
`,
  );

  run("pnpm", ["install", "--ignore-workspace"], consumer);
  const output = run("node", ["smoke.mjs"], consumer);
  if (!output.includes("consumer smoke passed")) {
    throw new Error(`unexpected smoke output: ${output}`);
  }
  console.log(`All ${LIBRARIES.length} packages install and run outside the workspace.`);
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
