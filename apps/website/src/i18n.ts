import en from "../i18n/en.json";
import localeList from "../i18n/locales.json";

export interface LocaleEntry {
  readonly code: string;
  readonly name: string;
  readonly dir: string;
}

/**
 * Per-page localization context. Locale pages are generated at build time, so
 * the only runtime input is the JSON block the generator injects into each
 * page: the current locale, the prefix back to the site root, this page's path
 * within a locale, and the translated chrome strings. English pages ship
 * without the translated strings and fall back to the bundled source messages.
 */
export interface PageI18n {
  readonly locale: string;
  /** Relative prefix from this page to the site root, e.g. "../../". */
  readonly root: string;
  /** This page's path inside a locale, e.g. "docs/usage/" ("" for home). */
  readonly page: string;
  readonly nav?: Record<string, string>;
  readonly notice?: string;
}

export const LOCALES: readonly LocaleEntry[] = localeList;

const FALLBACK: PageI18n = { locale: "en", root: "./", page: "" };

export function readPageI18n(): PageI18n {
  const block = document.getElementById("i18n-data");
  if (!block?.textContent) return FALLBACK;
  try {
    const parsed = JSON.parse(block.textContent) as Partial<PageI18n>;
    return {
      locale: parsed.locale ?? FALLBACK.locale,
      root: parsed.root ?? FALLBACK.root,
      page: parsed.page ?? FALLBACK.page,
      ...(parsed.nav ? { nav: parsed.nav } : {}),
      ...(parsed.notice ? { notice: parsed.notice } : {}),
    };
  } catch {
    return FALLBACK;
  }
}

/** Directory segment for a locale: "" for the default locale, "<code>/" otherwise. */
export function localeSegment(code: string): string {
  return code === "en" ? "" : `${code}/`;
}

/** URL of `page` in `code`, relative to the current page. */
export function localeHref(context: PageI18n, code: string, page = context.page): string {
  return `${context.root}${localeSegment(code)}${page}`;
}

export function navLabel(context: PageI18n, key: string): string {
  return context.nav?.[key] ?? (en as Record<string, string>)[`nav.${key}`] ?? key;
}

export function stageLabel(context: PageI18n): string {
  return context.nav?.["stage"] ?? en["brand.stage"];
}

export function noticeLabel(context: PageI18n): string {
  return context.notice ?? en["docs.englishOnly"];
}
