import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { loadSiteContent } from "../apps/website/content.mjs";

const run = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteRoot = path.join(repositoryRoot, "apps/website");
const output = path.join(siteRoot, "dist");
const serverOutput = path.join(siteRoot, ".ssr");

function assertBuildDirectory(target, expectedName) {
  if (path.dirname(target) !== siteRoot || path.basename(target) !== expectedName) {
    throw new Error(`refusing to clean unexpected website build directory: ${target}`);
  }
}

function escapeAttribute(value) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

function embeddedJson(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll("-->", "--\\u003e");
}

function outputPathForRoute(route) {
  return route === "/" ? "index.html" : `${route.slice(1)}/index.html`;
}

function cookieLanguage(code) {
  if (code === "zh-CN") return "zh-Hans";
  if (code === "zh-TW") return "zh-Hant";
  return code;
}

function legacyRedirect(locale, page) {
  const target = `/${page}`;
  const language = cookieLanguage(locale.code);
  const script = `(()=>{const value=${JSON.stringify(language)};try{localStorage.setItem("dopejs.locale",value)}catch{}const shared=location.hostname==="dopejs.com"||location.hostname.endsWith(".dopejs.com");const domain=shared?"; Domain=dopejs.com":"";const secure=location.protocol==="https:"?"; Secure":"";document.cookie="dopejs_locale="+encodeURIComponent(value)+"; Path=/; Max-Age=31536000; SameSite=Lax"+domain+secure;location.replace(${JSON.stringify(target)}+location.search+location.hash)})();`;
  return `<!doctype html><html lang="${escapeAttribute(language)}" dir="${escapeAttribute(locale.dir)}"><head><meta charset="utf-8"><meta name="robots" content="noindex"><link rel="canonical" href="https://deckle.dopejs.com${target}"><meta http-equiv="refresh" content="0;url=${escapeAttribute(target)}"><title>Deckle</title></head><body><script>${script}</script><a href="${escapeAttribute(target)}">Continue to Deckle</a></body></html>`;
}

assertBuildDirectory(output, "dist");
assertBuildDirectory(serverOutput, ".ssr");
await rm(output, { recursive: true, force: true });
await rm(serverOutput, { recursive: true, force: true });

try {
  await run("pnpm", ["exec", "vite", "build", "--config", "apps/website/vite.config.ts"], {
    cwd: repositoryRoot,
  });
  await run(
    "pnpm",
    [
      "exec",
      "vite",
      "build",
      "--config",
      "apps/website/vite.config.ts",
      "--ssr",
      "src/ssr.tsx",
      "--outDir",
      ".ssr",
      "--emptyOutDir",
    ],
    { cwd: repositoryRoot },
  );

  const [{ render }, template, content, localeList] = await Promise.all([
    import(pathToFileURL(path.join(serverOutput, "ssr.js")).href),
    readFile(path.join(output, "index.html"), "utf8"),
    loadSiteContent(),
    readFile(path.join(siteRoot, "i18n/locales.json"), "utf8").then(JSON.parse),
  ]);

  for (const page of content.pages) {
    const siteDocument = content.documentForRoute(page.route);
    const payload = siteDocument.translations.en ?? Object.values(siteDocument.translations)[0];
    if (payload === undefined) throw new Error(`site route ${page.route} has no English payload`);
    const rendered = render(siteDocument);
    const canonical = `https://deckle.dopejs.com${payload.page.href}`;
    const html = template
      .replace("<title>Deckle</title>", `<title>${escapeAttribute(payload.page.title)}</title>`)
      .replace(
        /<meta\s+name="description"\s+content="[^"]*"\s*\/>/u,
        `<meta name="description" content="${escapeAttribute(payload.page.description)}">`,
      )
      .replace("</head>", `  <link rel="canonical" href="${canonical}">\n  </head>`)
      .replace(
        '<div id="root"></div>',
        `<div id="root">${rendered}</div><script id="deckle-site-payload" type="application/json">${embeddedJson(siteDocument)}</script>`,
      );
    const target = path.join(output, outputPathForRoute(page.route));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, html);
  }

  const searchDirectory = path.join(output, "__deckle");
  await mkdir(searchDirectory, { recursive: true });
  await writeFile(
    path.join(searchDirectory, "search-index.json"),
    JSON.stringify(content.searchIndex),
  );

  const legacyPages = ["", "playground/", "docs/usage/", "docs/design/"];
  let redirects = 0;
  for (const locale of localeList.filter((candidate) => candidate.code !== "en")) {
    for (const page of legacyPages) {
      const target = path.join(output, locale.code, page, "index.html");
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, legacyRedirect(locale, page));
      redirects += 1;
    }
  }

  process.stdout.write(
    `Deckle React site built: ${String(content.pages.length)} static pages, ${String(redirects)} legacy locale redirects\n`,
  );
} finally {
  await rm(serverOutput, { recursive: true, force: true });
}
