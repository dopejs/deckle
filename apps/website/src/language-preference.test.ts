import { describe, expect, it } from "vitest";

import { languageCookie, matchSupportedLanguage } from "./language-preference";

describe("website language preference", () => {
  it("maps the Chinese values written by dopejs-page to Deckle locales", () => {
    expect(matchSupportedLanguage("zh-Hans")).toBe("zh-CN");
    expect(matchSupportedLanguage("zh-CN")).toBe("zh-CN");
    expect(matchSupportedLanguage("zh-Hant")).toBe("zh-TW");
    expect(matchSupportedLanguage("zh-HK")).toBe("zh-TW");
  });

  it("matches supported languages with regional browser tags", () => {
    expect(matchSupportedLanguage("ja-JP")).toBe("ja");
    expect(matchSupportedLanguage("es-MX")).toBe("es");
    expect(matchSupportedLanguage("AR-sa")).toBe("ar");
  });

  it("ignores unsupported or missing values", () => {
    expect(matchSupportedLanguage("pt-BR")).toBeUndefined();
    expect(matchSupportedLanguage(null)).toBeUndefined();
  });

  it("uses the exact cross-subdomain cookie contract shared with dopejs-page", () => {
    expect(languageCookie("zh-Hans", "deckle.dopejs.com", true)).toBe(
      "dopejs_locale=zh-Hans; Path=/; Max-Age=31536000; SameSite=Lax; Domain=dopejs.com; Secure",
    );
    expect(languageCookie("ja", "localhost", false)).toBe(
      "dopejs_locale=ja; Path=/; Max-Age=31536000; SameSite=Lax",
    );
  });
});
