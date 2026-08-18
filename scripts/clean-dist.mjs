#!/usr/bin/env node
/**
 * Remove a package's build output before rebuilding.
 *
 * Two failure modes this prevents: a stale `.tsbuildinfo` convincing tsc that
 * output is current when it is not (which silently shipped packages without
 * declaration files), and orphaned files from renamed or deleted sources
 * staying in `dist` and getting published.
 */
import { rmSync } from "node:fs";
import { join } from "node:path";

const packageRoot = process.cwd();
for (const target of ["dist", join("node_modules", ".cache")]) {
  rmSync(join(packageRoot, target), { recursive: true, force: true });
}
