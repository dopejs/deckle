import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_PREFIX = "@dopejs/deckle-";

export async function findInvalidPackageNames(rootDirectory) {
  const invalid = [];

  for (const workspaceDirectory of ["apps", "packages"]) {
    const parent = path.join(rootDirectory, workspaceDirectory);
    let entries;
    try {
      entries = await readdir(parent, { withFileTypes: true });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        continue;
      }
      throw error;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(parent, entry.name, "package.json");
      let manifest;
      try {
        manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
          continue;
        }
        throw new Error(`Cannot parse ${manifestPath}`, { cause: error });
      }

      if (typeof manifest.name !== "string" || !manifest.name.startsWith(PACKAGE_PREFIX)) {
        invalid.push({ manifestPath, name: manifest.name });
      }
    }
  }

  return invalid;
}

async function main() {
  const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const invalid = await findInvalidPackageNames(rootDirectory);
  if (invalid.length === 0) {
    console.log(`All workspace packages use ${PACKAGE_PREFIX}* names.`);
    return;
  }

  for (const item of invalid) {
    console.error(`${item.manifestPath}: invalid package name ${JSON.stringify(item.name)}`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
