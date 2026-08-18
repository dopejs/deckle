#!/usr/bin/env node
/**
 * Stage the files every published tarball must carry alongside its build
 * output. Apache-2.0 requires recipients to get a copy of the license, and npm
 * only includes files that live inside the package directory — the repository
 * root copy would silently not ship.
 *
 * Run from a package directory as its `prepack` script.
 */
import { copyFileSync } from "node:fs";
import { join, resolve } from "node:path";

const packageRoot = process.cwd();
const repoRoot = resolve(import.meta.dirname, "..");

for (const file of ["LICENSE", "NOTICE"]) {
  copyFileSync(join(repoRoot, file), join(packageRoot, file));
}
