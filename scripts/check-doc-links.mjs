import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const markdownLink = /\[[^\]]*\]\(([^)]+)\)/g;

async function collectMarkdownFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if ([".git", "node_modules"].includes(entry.name)) continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectMarkdownFiles(entryPath)));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(entryPath);
  }
  return files;
}

const failures = [];
for (const file of await collectMarkdownFiles(rootDirectory)) {
  const source = await readFile(file, "utf8");
  for (const match of source.matchAll(markdownLink)) {
    const target = match[1];
    if (!target || /^(?:https?:|mailto:|#)/.test(target)) continue;
    const withoutAnchor = target.split("#", 1)[0];
    if (!withoutAnchor) continue;
    const resolved = path.resolve(path.dirname(file), decodeURIComponent(withoutAnchor));
    try {
      await access(resolved);
    } catch {
      failures.push(`${path.relative(rootDirectory, file)} -> ${target}`);
    }
  }
}

if (failures.length > 0) {
  console.error(`Broken local documentation links:\n${failures.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log("All local documentation links resolve.");
}
