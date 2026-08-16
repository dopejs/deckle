import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const maximumBytes = 256 * 1024 * 1024;
const candidates = [
  path.join(repositoryRoot, "target"),
  path.join(repositoryRoot, ".cache", "cargo-target"),
];

async function directorySize(entryPath) {
  let metadata;
  try {
    metadata = await lstat(entryPath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return 0;
    throw error;
  }

  if (metadata.isSymbolicLink()) {
    throw new Error(`Cargo artifact path must not be a symbolic link: ${entryPath}`);
  }
  if (!metadata.isDirectory()) return metadata.size;

  let total = 0;
  for (const entry of await readdir(entryPath)) {
    total += await directorySize(path.join(entryPath, entry));
  }
  return total;
}

let total = 0;
for (const candidate of candidates) total += await directorySize(candidate);

if (total > maximumBytes) {
  throw new Error(
    `Cargo artifacts use ${(total / 1024 / 1024).toFixed(1)} MiB; the repository limit is ${maximumBytes / 1024 / 1024} MiB. Run Rust commands through pnpm rust:check/test/clippy so cleanup runs.`,
  );
}

console.log(`Cargo artifact footprint: ${(total / 1024 / 1024).toFixed(1)} MiB.`);
