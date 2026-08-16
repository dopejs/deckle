import { access, mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheRoot = path.join(repositoryRoot, ".cache");
const targetDirectory = path.join(cacheRoot, "cargo-target");
const allowedCommands = new Set(["check", "clippy", "test"]);

function validateCleanupTarget() {
  if (
    path.dirname(targetDirectory) !== cacheRoot ||
    path.basename(targetDirectory) !== "cargo-target" ||
    !targetDirectory.startsWith(`${repositoryRoot}${path.sep}`)
  ) {
    throw new Error(`Refusing to manage unexpected Cargo target directory: ${targetDirectory}`);
  }
}

async function hasRustWorkspace() {
  try {
    await access(path.join(repositoryRoot, "Cargo.toml"));
    return true;
  } catch {
    return false;
  }
}

async function run(command, arguments_) {
  await new Promise((resolve, reject) => {
    const child = spawn("cargo", [command, ...arguments_], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        CARGO_INCREMENTAL: "0",
        CARGO_TARGET_DIR: targetDirectory,
      },
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`cargo ${command} terminated by ${signal}`));
      else if (code === 0) resolve();
      else reject(new Error(`cargo ${command} exited with status ${String(code)}`));
    });
  });
}

const [command, ...arguments_] = process.argv.slice(2);
if (!command || !allowedCommands.has(command)) {
  throw new Error(`Expected one of: ${[...allowedCommands].join(", ")}`);
}

if (!(await hasRustWorkspace())) {
  console.log("No Rust workspace is present; nothing to run.");
  process.exit(0);
}

validateCleanupTarget();
await mkdir(cacheRoot, { recursive: true });

let failure;
let cleanupFailure;
try {
  await run(command, arguments_);
} catch (error) {
  failure = error;
} finally {
  try {
    await rm(targetDirectory, { force: true, recursive: true });
    console.log(`Removed Cargo artifacts from ${targetDirectory}.`);
  } catch (error) {
    cleanupFailure = error;
  }
}

if (cleanupFailure) {
  throw new AggregateError(
    failure ? [failure, cleanupFailure] : [cleanupFailure],
    "Cargo command cleanup failed",
  );
}
if (failure) throw failure;
