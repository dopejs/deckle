#!/usr/bin/env node
/**
 * Post-build step: derive one static page per locale from the built English
 * pages, so every language is a real crawlable URL (/zh-CN/, /ar/docs/usage/…)
 * with the correct lang/dir, translated copy, and hreflang alternates.
 *
 * Fails the build on a missing locale file or missing translation key rather
 * than silently shipping half-translated pages.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { localeSegment, localizePage } from "./locale-transform.mjs";

const appRoot = resolve(import.meta.dirname, "..");
const distDir = join(appRoot, "dist");
const i18nDir = join(appRoot, "i18n");

/** Page paths inside a locale, matching the Vite HTML entries. */
const PAGES = ["", "playground/", "docs/usage/", "docs/design/"];

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

const locales = await readJson(join(i18nDir, "locales.json"));
const available = new Set(
  (await readdir(i18nDir))
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -5)),
);
for (const locale of locales) {
  if (!available.has(locale.code)) {
    throw new Error(
      `Locale "${locale.code}" is registered but i18n/${locale.code}.json is missing`,
    );
  }
}

const source = await readJson(join(i18nDir, "en.json"));
const sourceKeys = Object.keys(source);

let written = 0;
for (const locale of locales) {
  const messages = await readJson(join(i18nDir, `${locale.code}.json`));
  const missing = sourceKeys.filter((key) => messages[key] === undefined);
  if (missing.length > 0) {
    throw new Error(`Locale "${locale.code}" is missing keys: ${missing.join(", ")}`);
  }

  for (const page of PAGES) {
    const englishPath = join(distDir, page, "index.html");
    const html = await readFile(englishPath, "utf8");
    const localized = localizePage(html, { locale, page, messages, locales });
    const outPath = join(distDir, localeSegment(locale.code), page, "index.html");
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, localized, "utf8");
    written += 1;
  }
}

console.log(
  `Emitted ${written} localized pages for ${locales.length} locales: ${locales.map((l) => l.code).join(", ")}`,
);
