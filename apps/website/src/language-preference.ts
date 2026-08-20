import { SITE_LOCALES, localeForPath } from "./locales";

const STORAGE_KEY = "dopejs.locale";
const COOKIE_KEY = "dopejs_locale";

export function languageCookie(value: string, hostname: string, secure: boolean): string {
  const onDopejs = hostname === "dopejs.com" || hostname.endsWith(".dopejs.com");
  const domain = onDopejs ? "; Domain=dopejs.com" : "";
  return `${COOKIE_KEY}=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; SameSite=Lax${domain}${secure ? "; Secure" : ""}`;
}

export function matchSupportedLanguage(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  const normalized = value.trim().toLocaleLowerCase();
  if (["zh-hans", "zh-cn", "zh-sg"].includes(normalized)) return "zh-CN";
  if (["zh-hant", "zh-tw", "zh-hk", "zh-mo"].includes(normalized)) return "zh-TW";
  const exact = SITE_LOCALES.find((locale) => locale.lang.toLocaleLowerCase() === normalized);
  if (exact !== undefined) return exact.path;
  const language = normalized.split("-")[0];
  return SITE_LOCALES.find((locale) => locale.lang.toLocaleLowerCase().split("-")[0] === language)
    ?.path;
}

function cookiePreference(): string | undefined {
  const prefix = `${COOKIE_KEY}=`;
  for (const part of document.cookie.split(";")) {
    const item = part.trim();
    if (!item.startsWith(prefix)) continue;
    try {
      return matchSupportedLanguage(decodeURIComponent(item.slice(prefix.length)));
    } catch {
      // Ignore a malformed value and continue with browser language detection.
    }
  }
  return undefined;
}

/** Matches Pingo: explicit local choice, shared cookie, then browser languages. */
export function readLanguagePreference(): string {
  try {
    const local = matchSupportedLanguage(localStorage.getItem(STORAGE_KEY));
    if (local !== undefined) return local;
  } catch {
    // Persistence may be disabled; cookie and browser detection still work.
  }
  const cookie = cookiePreference();
  if (cookie !== undefined) return cookie;
  const languages = navigator.languages.length === 0 ? [navigator.language] : navigator.languages;
  for (const language of languages) {
    const resolved = matchSupportedLanguage(language);
    if (resolved !== undefined) return resolved;
  }
  return "en";
}

/** Persists locally and mirrors the preference to every dopejs.com subdomain. */
export function writeLanguagePreference(code: string): void {
  const value = localeForPath(code).lang;
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // The domain cookie remains available when local storage is disabled.
  }
  document.cookie = languageCookie(value, location.hostname, location.protocol === "https:");
}
