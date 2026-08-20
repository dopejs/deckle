import localeList from "../i18n/locales.json";

export interface SiteLocale {
  readonly path: string;
  readonly lang: string;
  readonly label: string;
  readonly dir: "ltr" | "rtl";
}

export const SITE_LOCALES: readonly SiteLocale[] = localeList.map((locale) => ({
  path: locale.code,
  lang: locale.code === "zh-CN" ? "zh-Hans" : locale.code === "zh-TW" ? "zh-Hant" : locale.code,
  label: locale.name,
  dir: locale.dir as "ltr" | "rtl",
}));

export function localeForPath(path: string): SiteLocale {
  return SITE_LOCALES.find((locale) => locale.path === path) ?? SITE_LOCALES[0]!;
}

/** Returns a static-host-safe URL for a generated route. */
export function pageHref(route: string): string {
  return route === "/" ? route : `${route.replace(/\/$/u, "")}/`;
}
