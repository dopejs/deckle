/**
 * Pure transforms used to derive a localized page from the built English page.
 * Kept free of I/O so they can be unit tested.
 */

const SITE_ORIGIN = "https://deckle.dopejs.com";

/** Directory segment for a locale: "" for the default locale, "<code>/" otherwise. */
export function localeSegment(code) {
  return code === "en" ? "" : `${code}/`;
}

/**
 * A localized page sits one directory deeper than its English counterpart, so
 * every relative asset reference gains one level. Only `./`- and `../`-prefixed
 * references are asset paths emitted by the bundler; bare relative links
 * (`playground/`) already resolve inside the locale directory and must not move.
 */
export function deepenRelativePath(path) {
  if (path.startsWith("./")) return `../${path.slice(2)}`;
  if (path.startsWith("../")) return `../${path}`;
  return path;
}

export function deepenAssetPaths(html) {
  return html.replace(
    /\b(src|href)="(\.\.?\/[^"]*)"/g,
    (_match, attribute, path) => `${attribute}="${deepenRelativePath(path)}"`,
  );
}

function escapeAttribute(value) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/**
 * Replace the content of every `data-i18n` element, plus `data-i18n-content`
 * (meta content) and `data-i18n-label` (aria-label) attributes.
 *
 * Message values may contain inline markup (`<em>`), which is intentional:
 * they are first-party build-time content, never user input. Any key missing
 * from the locale file keeps the English text rather than rendering the key.
 */
export function applyMessages(html, messages) {
  // The closing tag may carry whitespace before ">" (`</span\n>`), which the
  // formatter produces; matching only "</span>" would let the lazy body run
  // past this element and swallow later markup.
  let output = html.replace(
    /(<([a-zA-Z0-9-]+)\b[^>]*\bdata-i18n="([^"]+)"[^>]*>)([\s\S]*?)(<\/\2\s*>)/g,
    (match, open, _tag, key, _body, close) => {
      const value = messages[key];
      return value === undefined ? match : `${open}${value}${close}`;
    },
  );

  output = output.replace(
    /<meta([^>]*?)\bdata-i18n-content="([^"]+)"([^>]*?)>/g,
    (match, before, key, after) => {
      const value = messages[key];
      if (value === undefined) return match;
      const stripped = `${before}${after}`.replace(/\s*content="[^"]*"/, "");
      return `<meta${stripped} content="${escapeAttribute(value)}">`;
    },
  );

  output = output.replace(
    /(<[a-zA-Z0-9-]+\b[^>]*?)\bdata-i18n-label="([^"]+)"([^>]*?>)/g,
    (match, before, key, after) => {
      const value = messages[key];
      if (value === undefined) return match;
      const stripped = `${before}${after}`.replace(/\s*aria-label="[^"]*"/, "");
      return stripped.replace(/>$/, ` aria-label="${escapeAttribute(value)}">`);
    },
  );

  return output;
}

/** Set the document language and writing direction. */
export function applyLocaleAttributes(html, locale) {
  return html.replace(/<html[^>]*>/, `<html lang="${locale.code}" dir="${locale.dir}">`);
}

/**
 * Inject the per-page runtime context the header needs: locale, prefix back to
 * the site root, this page's path, translated chrome labels, and the doc notice.
 */
export function applyI18nData(html, locale, page, messages) {
  const depth = page === "" ? 0 : page.split("/").filter(Boolean).length;
  const root = "../".repeat(depth + (locale.code === "en" ? 0 : 1)) || "./";
  const data = {
    locale: locale.code,
    root,
    page,
    nav: {
      overview: messages["nav.overview"],
      usage: messages["nav.usage"],
      design: messages["nav.design"],
      playground: messages["nav.playground"],
      github: messages["nav.github"],
      language: messages["nav.language"],
      stage: messages["brand.stage"],
    },
    notice: messages["docs.englishOnly"],
  };
  return html.replace(
    /(<script type="application\/json" id="i18n-data">)[\s\S]*?(<\/script>)/,
    `$1${JSON.stringify(data)}$2`,
  );
}

/** hreflang alternates for every locale plus x-default, as absolute URLs. */
export function buildAlternates(page, locales) {
  const links = locales.map(
    (locale) =>
      `<link rel="alternate" hreflang="${locale.code}" href="${SITE_ORIGIN}/${localeSegment(locale.code)}${page}">`,
  );
  links.push(`<link rel="alternate" hreflang="x-default" href="${SITE_ORIGIN}/${page}">`);
  return links.join("\n    ");
}

export function applyAlternates(html, page, locales) {
  return html.replace(/<\/head>/, `  ${buildAlternates(page, locales)}\n  </head>`);
}

/** Structural tags whose count must survive text substitution untouched. */
const STRUCTURAL_TAGS = [
  "section",
  "main",
  "footer",
  "header",
  "div",
  "p",
  "li",
  "ul",
  "article",
  "h1",
  "h2",
  "h3",
];

function countClosing(html, tag) {
  return html.match(new RegExp(`</${tag}\\s*>`, "g"))?.length ?? 0;
}

/**
 * Guard against a substitution consuming markup: message text may add inline
 * tags, but it must never change how many structural elements the page closes.
 */
export function assertStructurePreserved(english, localized, label) {
  for (const tag of STRUCTURAL_TAGS) {
    const before = countClosing(english, tag);
    const after = countClosing(localized, tag);
    if (before !== after) {
      throw new Error(
        `${label}: localization changed the document structure — ` +
          `expected ${before} </${tag}> but produced ${after}`,
      );
    }
  }
}

/** Full English-page → localized-page transform. */
export function localizePage(html, { locale, page, messages, locales }) {
  let output = applyLocaleAttributes(html, locale);
  output = applyMessages(output, messages);
  output = applyI18nData(output, locale, page, messages);
  output = applyAlternates(output, page, locales);
  if (locale.code !== "en") output = deepenAssetPaths(output);
  assertStructurePreserved(html, output, `${locale.code} /${page}`);
  return output;
}
