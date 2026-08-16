import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { findInvalidPackageNames } from "./check-package-names.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

async function workspaceWithPackage(workspace, directoryName, name) {
  const root = await mkdtemp(path.join(os.tmpdir(), "dope-canvas-package-check-"));
  temporaryDirectories.push(root);
  const packageDirectory = path.join(root, workspace, directoryName);
  await mkdir(packageDirectory, { recursive: true });
  await writeFile(path.join(packageDirectory, "package.json"), JSON.stringify({ name }));
  return root;
}

describe("findInvalidPackageNames", () => {
  it("accepts the required namespace", async () => {
    const root = await workspaceWithPackage("packages", "core", "@dopejs/canvas-core");
    await expect(findInvalidPackageNames(root)).resolves.toEqual([]);
  });

  it("rejects package names outside the required namespace", async () => {
    const root = await workspaceWithPackage("apps", "probe", "canvas-probe");
    const invalid = await findInvalidPackageNames(root);
    expect(invalid).toHaveLength(1);
    expect(invalid[0]?.name).toBe("canvas-probe");
  });
});
