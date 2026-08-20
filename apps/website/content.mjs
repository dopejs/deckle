import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import MarkdownIt from "markdown-it";
import anchor from "markdown-it-anchor";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(appRoot, "../..");
const docsRoot = path.join(repositoryRoot, "docs");
const i18nRoot = path.join(appRoot, "i18n");

const ROUTES = [
  {
    route: "/",
    href: "/",
    layout: "home",
    titleKey: "meta.home.title",
    descriptionKey: "meta.home.description",
    sourcePath: "content/home.html",
  },
  {
    route: "/docs/usage",
    href: "/docs/usage/",
    layout: "doc",
    titleKey: "meta.usage.title",
    descriptionKey: "meta.usage.description",
    sourcePath: "usage.md",
  },
  {
    route: "/docs/design",
    href: "/docs/design/",
    layout: "doc",
    titleKey: "meta.design.title",
    descriptionKey: "meta.design.description",
    sourcePath: "design.md",
  },
  {
    route: "/docs/plan",
    href: "/docs/plan/",
    layout: "doc",
    sourcePath: "plan.md",
  },
  {
    route: "/docs/security",
    href: "/docs/security/",
    layout: "doc",
    sourcePath: "security.md",
  },
  {
    route: "/docs/compatibility",
    href: "/docs/compatibility/",
    layout: "doc",
    sourcePath: "compatibility.md",
  },
  {
    route: "/docs/benchmark-protocol",
    href: "/docs/benchmark-protocol/",
    layout: "doc",
    sourcePath: "benchmark-protocol.md",
  },
  {
    route: "/playground",
    href: "/playground/",
    layout: "playground",
    titleKey: "meta.playground.title",
    descriptionKey: "meta.playground.description",
  },
];

const DOCUMENT_HREFS = new Map(
  ROUTES.filter((definition) => definition.layout === "doc").map((definition) => [
    definition.sourcePath,
    definition.href,
  ]),
);

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function escapeAttribute(value) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

/** Applies the existing first-party translation catalog to the home-page fragment. */
export function applyMessages(html, messages) {
  let output = html.replace(
    /(<([a-zA-Z0-9-]+)\b[^>]*\bdata-i18n="([^"]+)"[^>]*>)([\s\S]*?)(<\/\2\s*>)/g,
    (match, open, _tag, key, _body, close) =>
      messages[key] === undefined ? match : `${open}${messages[key]}${close}`,
  );
  output = output.replace(
    /(<[a-zA-Z0-9-]+\b[^>]*?)\s+data-i18n-label="([^"]+)"([^>]*?>)/g,
    (match, before, key, after) => {
      const value = messages[key];
      if (value === undefined) return match;
      const stripped = `${before}${after}`.replace(/\s+aria-label="[^"]*"/, "");
      return stripped.replace(/>$/, ` aria-label="${escapeAttribute(value)}">`);
    },
  );
  return output;
}

function extractHomeFragment(source) {
  const main = source.match(/<main>[\s\S]*?<\/main>/u)?.[0];
  if (main === undefined) {
    throw new Error("website home content must contain one main element");
  }
  return main;
}

function splitSuffix(value) {
  const index = value.search(/[?#]/u);
  return index === -1 ? [value, ""] : [value.slice(0, index), value.slice(index)];
}

function markdownHref(value, sourcePath) {
  if (/^(?:[a-z]+:|#|\/\/)/iu.test(value)) return value;
  const [pathname, suffix] = splitSuffix(value);
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), pathname));
  const siteHref = DOCUMENT_HREFS.get(resolved);
  if (siteHref !== undefined) return `${siteHref}${suffix}`;
  if (resolved.startsWith("../")) return value;
  return `https://github.com/dopejs/deckle/blob/main/docs/${resolved}${suffix}`;
}

function slugify(value) {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s_-]/gu, "")
    .replace(/[\s_]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function createMarkdown() {
  const markdown = new MarkdownIt({ html: true, linkify: true });
  markdown.use(anchor, { slugify });
  const originalLink = markdown.renderer.rules.link_open;
  markdown.renderer.rules.link_open = (tokens, index, options, environment, self) => {
    const href = tokens[index].attrGet("href");
    if (href !== null) {
      const target = markdownHref(href, environment.sourcePath);
      tokens[index].attrSet("href", target);
      if (/^https?:/u.test(target)) {
        tokens[index].attrSet("target", "_blank");
        tokens[index].attrSet("rel", "noreferrer");
      }
    }
    return (
      originalLink?.(tokens, index, options, environment, self) ??
      self.renderToken(tokens, index, options)
    );
  };
  return markdown;
}

function inlineText(token) {
  if (token.type !== "inline") return "";
  return token.content
    .replace(/<[^>]+>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function renderMarkdown(markdown, source, sourcePath) {
  const environment = { sourcePath };
  const tokens = markdown.parse(source, environment);
  const headings = [];
  const tableOfContents = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "heading_open") continue;
    const level = Number(token.tag.slice(1));
    const title = inlineText(tokens[index + 1]);
    if (title !== "") headings.push(title);
    if ((level === 2 || level === 3) && title !== "") {
      tableOfContents.push({ id: token.attrGet("id") ?? slugify(title), level, title });
    }
  }
  return {
    html: markdown.renderer.render(tokens, markdown.options, environment),
    headings,
    tableOfContents,
    plainText: tokens.map(inlineText).filter(Boolean).join(" ").slice(0, 8_000),
  };
}

function requestRoute(pathname, localeCodes) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    decoded = pathname;
  }
  const segments = decoded.split("/").filter(Boolean);
  if (segments.length > 0 && localeCodes.has(segments[0])) segments.shift();
  const normalized = `/${segments.join("/")}`.replace(/\/index\.html$/u, "").replace(/\/+$/u, "");
  return normalized === "" ? "/" : normalized;
}

export async function loadSiteContent() {
  const locales = await readJson(path.join(i18nRoot, "locales.json"));
  const available = new Set(
    (await readdir(i18nRoot))
      .filter((name) => name.endsWith(".json") && name !== "locales.json")
      .map((name) => name.slice(0, -5)),
  );
  for (const locale of locales) {
    if (!available.has(locale.code)) {
      throw new Error(`registered locale ${locale.code} is missing its translation catalog`);
    }
  }

  const catalogEntries = await Promise.all(
    locales.map(async (locale) => [
      locale.code,
      await readJson(path.join(i18nRoot, `${locale.code}.json`)),
    ]),
  );
  const catalogs = Object.fromEntries(catalogEntries);
  const sourceKeys = Object.keys(catalogs.en);
  for (const locale of locales) {
    const missing = sourceKeys.filter((key) => catalogs[locale.code][key] === undefined);
    if (missing.length > 0) {
      throw new Error(`locale ${locale.code} is missing keys: ${missing.join(", ")}`);
    }
  }

  const markdown = createMarkdown();
  const homePath = path.join(appRoot, "content/home.html");
  const [homeFile, homeMetadata] = await Promise.all([readFile(homePath, "utf8"), stat(homePath)]);
  const homeSource = extractHomeFragment(homeFile);
  const sources = new Map();
  sources.set("/", {
    html: homeSource,
    headings: [],
    tableOfContents: [],
    plainText: homeSource
      .replace(/<[^>]+>/gu, " ")
      .replace(/\s+/gu, " ")
      .slice(0, 8_000),
    lastUpdated: homeMetadata.mtime.toISOString(),
  });
  for (const definition of ROUTES.filter((page) => page.layout === "doc")) {
    const absolute = path.join(docsRoot, definition.sourcePath);
    const [source, metadata] = await Promise.all([readFile(absolute, "utf8"), stat(absolute)]);
    sources.set(definition.route, {
      ...renderMarkdown(markdown, source, definition.sourcePath),
      lastUpdated: metadata.mtime.toISOString(),
    });
  }

  const pageFor = (definition, localePath) => {
    const messages = catalogs[localePath];
    const source = sources.get(definition.route);
    const html =
      definition.layout === "home"
        ? applyMessages(source.html, messages)
        : definition.layout === "doc"
          ? source.html
          : "";
    return {
      route: definition.route,
      href: definition.href,
      ...(definition.sourcePath === undefined ? {} : { sourcePath: definition.sourcePath }),
      layout: definition.layout,
      localePath,
      title:
        definition.titleKey === undefined
          ? `${source.headings[0] ?? "Deckle documentation"} — Deckle`
          : messages[definition.titleKey],
      description:
        definition.descriptionKey === undefined
          ? `${source.headings[0] ?? "Deckle"} project documentation.`
          : messages[definition.descriptionKey],
      html,
      contentLanguage:
        definition.layout === "doc"
          ? "en"
          : localePath === "zh-CN"
            ? "zh-Hans"
            : localePath === "zh-TW"
              ? "zh-Hant"
              : localePath,
      messages,
      ...(definition.layout === "doc" && localePath !== "en"
        ? { notice: messages["docs.englishOnly"] }
        : {}),
      tableOfContents: source?.tableOfContents ?? [],
      lastUpdated: source?.lastUpdated ?? new Date(0).toISOString(),
    };
  };

  const docRoutes = ROUTES.filter((definition) => definition.layout === "doc");
  const payloadForPage = (definition, localePath = "en") => {
    const index = docRoutes.indexOf(definition);
    const link = (candidate) => {
      if (candidate === undefined) return undefined;
      const page = pageFor(candidate, localePath);
      return { href: page.href, title: page.title };
    };
    return {
      page: pageFor(definition, localePath),
      ...(index > 0 ? { previous: link(docRoutes[index - 1]) } : {}),
      ...(index >= 0 && index < docRoutes.length - 1 ? { next: link(docRoutes[index + 1]) } : {}),
    };
  };
  const documents = new Map(
    ROUTES.map((definition) => [
      definition.route,
      {
        translations: Object.fromEntries(
          locales.map((locale) => [locale.code, payloadForPage(definition, locale.code)]),
        ),
      },
    ]),
  );
  const searchIndex = ROUTES.flatMap((definition) =>
    locales.map((locale) => {
      const page = pageFor(definition, locale.code);
      const source = sources.get(definition.route);
      return {
        route: page.route,
        href: page.href,
        title: page.title,
        description: page.description,
        localePath: locale.code,
        headings: source?.headings ?? [],
        text:
          definition.layout === "home"
            ? page.html
                .replace(/<[^>]+>/gu, " ")
                .replace(/\s+/gu, " ")
                .slice(0, 8_000)
            : (source?.plainText ?? ""),
      };
    }),
  );
  const localeCodes = new Set(locales.map((locale) => locale.code));

  return {
    pages: ROUTES,
    locales,
    searchIndex,
    payloadForPage,
    documentForRoute(route) {
      const document = documents.get(route);
      if (document === undefined) throw new Error(`unknown website route ${route}`);
      return document;
    },
    payloadForPath(pathname) {
      return documents.get(requestRoute(pathname, localeCodes)) ?? documents.get("/");
    },
  };
}
