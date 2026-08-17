import { describe, expect, it } from "vitest";
import {
  applyAlternates,
  applyI18nData,
  applyLocaleAttributes,
  applyMessages,
  assertStructurePreserved,
  buildAlternates,
  deepenAssetPaths,
  deepenRelativePath,
  localeSegment,
  localizePage,
} from "./locale-transform.mjs";

const LOCALES = [
  { code: "en", name: "English", dir: "ltr" },
  { code: "ja", name: "日本語", dir: "ltr" },
  { code: "ar", name: "العربية", dir: "rtl" },
];

describe("localeSegment", () => {
  it("should return an empty segment for the default locale", () => {
    expect(localeSegment("en")).toBe("");
  });

  it("should return a directory segment for other locales", () => {
    expect(localeSegment("zh-CN")).toBe("zh-CN/");
  });
});

describe("deepenRelativePath", () => {
  it("should turn a same-directory path into a parent path", () => {
    expect(deepenRelativePath("./assets/main.js")).toBe("../assets/main.js");
  });

  it("should add one level to an already-relative parent path", () => {
    expect(deepenRelativePath("../../assets/main.js")).toBe("../../../assets/main.js");
  });

  it("should leave bare relative links untouched so they stay inside the locale", () => {
    expect(deepenRelativePath("playground/")).toBe("playground/");
    expect(deepenRelativePath("docs/usage/")).toBe("docs/usage/");
  });

  it("should leave absolute and external references untouched", () => {
    expect(deepenRelativePath("https://example.com/x")).toBe("https://example.com/x");
    expect(deepenRelativePath("/root.css")).toBe("/root.css");
  });
});

describe("deepenAssetPaths", () => {
  it("should deepen only bundler-relative src and href attributes", () => {
    const html =
      '<link href="./assets/a.css"><script src="../../assets/b.js"></script>' +
      '<a href="playground/">p</a><a href="https://x.example/">x</a>';
    expect(deepenAssetPaths(html)).toBe(
      '<link href="../assets/a.css"><script src="../../../assets/b.js"></script>' +
        '<a href="playground/">p</a><a href="https://x.example/">x</a>',
    );
  });
});

describe("applyMessages", () => {
  it("should replace element content by key", () => {
    const html = '<h1 data-i18n="hero.title">English</h1>';
    expect(applyMessages(html, { "hero.title": "日本語" })).toBe(
      '<h1 data-i18n="hero.title">日本語</h1>',
    );
  });

  it("should keep the English text when a key is absent", () => {
    const html = '<h1 data-i18n="hero.title">English</h1>';
    expect(applyMessages(html, {})).toBe(html);
  });

  it("should preserve inline markup coming from the message", () => {
    const html = '<p data-i18n="status.lede">plain</p>';
    const output = applyMessages(html, { "status.lede": "a <em>b</em> c" });
    expect(output).toContain("a <em>b</em> c");
  });

  it("should replace nested element content without swallowing siblings", () => {
    const html = '<li><strong data-i18n="f.t">T</strong> <span data-i18n="f.b">B</span></li>';
    expect(applyMessages(html, { "f.t": "标题", "f.b": "正文" })).toBe(
      '<li><strong data-i18n="f.t">标题</strong> <span data-i18n="f.b">正文</span></li>',
    );
  });

  it("should replace the meta description content attribute", () => {
    const html = '<meta name="description" data-i18n-content="m.d" content="English">';
    const output = applyMessages(html, { "m.d": "日本語の説明" });
    expect(output).toContain('content="日本語の説明"');
    expect(output).not.toContain("English");
  });

  it("should escape quotes when substituting attributes", () => {
    const html = '<meta name="description" data-i18n-content="m.d" content="x">';
    expect(applyMessages(html, { "m.d": 'a "b" c' })).toContain('content="a &quot;b&quot; c"');
  });

  it("should replace an aria-label", () => {
    const html = '<p role="img" data-i18n-label="a.l" aria-label="English">x</p>';
    const output = applyMessages(html, { "a.l": "ラベル" });
    expect(output).toContain('aria-label="ラベル"');
    expect(output).not.toContain('aria-label="English"');
  });

  it("should leave the title element replaceable like any other element", () => {
    const html = '<title data-i18n="meta.t">English</title>';
    expect(applyMessages(html, { "meta.t": "标题" })).toContain(">标题<");
  });

  it("should handle formatter-wrapped closing tags without swallowing later markup", () => {
    // Prettier emits `</span\n>` for long attribute lists; a substitution that
    // only recognised `</span>` used to consume every element up to the next one.
    const html =
      '<p><span data-i18n="a"\n  >A</span\n></p><section><span data-i18n="b">B</span></section>';
    const output = applyMessages(html, { a: "甲", b: "乙" });
    expect(output).toContain("甲");
    expect(output).toContain("乙");
    expect(output).toContain("</section>");
    expect(output.match(/<\/p>/g)).toHaveLength(1);
  });
});

describe("assertStructurePreserved", () => {
  const english = "<main><section><p>a</p><p>b</p></section></main>";

  it("should accept substitutions that only change text", () => {
    const localized = "<main><section><p>甲</p><p>乙</p></section></main>";
    expect(() => assertStructurePreserved(english, localized, "ja /")).not.toThrow();
  });

  it("should accept inline markup added by a message", () => {
    const localized = "<main><section><p>a <em>b</em></p><p>b</p></section></main>";
    expect(() => assertStructurePreserved(english, localized, "ja /")).not.toThrow();
  });

  it("should reject a substitution that swallowed structural tags", () => {
    const localized = "<main><section><p>甲</section></main>";
    expect(() => assertStructurePreserved(english, localized, "ja /")).toThrow(/structure/);
  });
});

describe("applyLocaleAttributes", () => {
  it("should set lang and dir, including RTL", () => {
    const html = '<html lang="en" dir="ltr"><head></head></html>';
    expect(applyLocaleAttributes(html, LOCALES[2])).toContain('<html lang="ar" dir="rtl">');
  });
});

describe("applyI18nData", () => {
  const html = '<script type="application/json" id="i18n-data">{"locale":"en"}</script>';
  const messages = {
    "nav.overview": "概要",
    "nav.usage": "使い方",
    "nav.design": "設計",
    "nav.playground": "プレイグラウンド",
    "nav.github": "GitHub",
    "nav.language": "言語",
    "brand.stage": "プレリリース",
    "docs.englishOnly": "英語のみ",
  };

  it("should compute the root prefix for a locale home page", () => {
    const data = JSON.parse(applyI18nData(html, LOCALES[1], "", messages).match(/>(\{.*\})</)[1]);
    expect(data).toMatchObject({ locale: "ja", root: "../", page: "" });
    expect(data.nav.overview).toBe("概要");
    expect(data.notice).toBe("英語のみ");
  });

  it("should compute the root prefix for a nested locale page", () => {
    const data = JSON.parse(
      applyI18nData(html, LOCALES[1], "docs/usage/", messages).match(/>(\{.*\})</)[1],
    );
    expect(data.root).toBe("../../../");
  });

  it("should compute the root prefix for English pages without a locale segment", () => {
    expect(
      JSON.parse(applyI18nData(html, LOCALES[0], "", messages).match(/>(\{.*\})</)[1]).root,
    ).toBe("./");
    expect(
      JSON.parse(applyI18nData(html, LOCALES[0], "docs/design/", messages).match(/>(\{.*\})</)[1])
        .root,
    ).toBe("../../");
  });
});

describe("buildAlternates", () => {
  it("should emit one absolute alternate per locale plus x-default", () => {
    const links = buildAlternates("docs/usage/", LOCALES);
    expect(links).toContain(
      '<link rel="alternate" hreflang="en" href="https://canvas.dopejs.com/docs/usage/">',
    );
    expect(links).toContain(
      '<link rel="alternate" hreflang="ar" href="https://canvas.dopejs.com/ar/docs/usage/">',
    );
    expect(links).toContain('hreflang="x-default"');
  });

  it("should insert alternates inside head", () => {
    const output = applyAlternates("<html><head></head><body></body></html>", "", LOCALES);
    expect(output.indexOf("hreflang")).toBeLessThan(output.indexOf("</head>"));
  });
});

describe("localizePage", () => {
  const html = [
    '<html lang="en" dir="ltr">',
    "<head>",
    '<title data-i18n="meta.home.title">English title</title>',
    '<script type="application/json" id="i18n-data">{"locale":"en","root":"./","page":""}</script>',
    '<link rel="stylesheet" href="./assets/style.css">',
    "</head>",
    '<body><h1 data-i18n="hero.title">English</h1><a href="playground/">go</a>',
    '<script type="module" src="./assets/main.js"></script></body>',
    "</html>",
  ].join("");

  const messages = {
    "meta.home.title": "日本語タイトル",
    "hero.title": "日本語見出し",
    "nav.overview": "概要",
    "nav.usage": "使い方",
    "nav.design": "設計",
    "nav.playground": "プレイグラウンド",
    "nav.github": "GitHub",
    "nav.language": "言語",
    "brand.stage": "プレリリース",
    "docs.englishOnly": "英語のみ",
  };

  it("should produce a fully localized page for a non-default locale", () => {
    const output = localizePage(html, { locale: LOCALES[1], page: "", messages, locales: LOCALES });
    expect(output).toContain('<html lang="ja" dir="ltr">');
    expect(output).toContain("日本語見出し");
    expect(output).toContain('href="../assets/style.css"');
    expect(output).toContain('src="../assets/main.js"');
    expect(output).toContain('href="playground/"'); // stays inside the locale
    expect(output).toContain('"root":"../"');
    expect(output).toContain('hreflang="x-default"');
  });

  it("should not deepen asset paths for the default locale", () => {
    const output = localizePage(html, {
      locale: LOCALES[0],
      page: "",
      messages: { ...messages, "hero.title": "English" },
      locales: LOCALES,
    });
    expect(output).toContain('href="./assets/style.css"');
    expect(output).toContain('<html lang="en" dir="ltr">');
  });

  it("should set rtl for right-to-left locales", () => {
    const output = localizePage(html, { locale: LOCALES[2], page: "", messages, locales: LOCALES });
    expect(output).toContain('dir="rtl"');
  });
});
