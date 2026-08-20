import { describe, expect, it } from "vitest";

import { applyMessages, loadSiteContent } from "../content.mjs";

describe("website content", () => {
  it("keeps one canonical document per route with every translation embedded", async () => {
    const content = await loadSiteContent();
    expect(content.pages.map((page) => page.href)).toEqual(
      expect.arrayContaining([
        "/",
        "/docs/usage/",
        "/docs/design/",
        "/docs/plan/",
        "/docs/security/",
        "/docs/compatibility/",
        "/docs/benchmark-protocol/",
        "/playground/",
      ]),
    );
    const home = content.documentForRoute("/");
    expect(Object.keys(home.translations)).toHaveLength(11);
    expect(home.translations["zh-CN"]!.page.html).toContain("面向 AI 生成网页制品");

    const demos = content.documentForRoute("/playground");
    expect(demos.translations["zh-CN"]!.page.title).toBe("场景 Demo — Deckle");
    expect(demos.translations.en!.page.description).not.toContain("Storybook");
  });

  it("resolves old localized paths to their canonical document during development", async () => {
    const content = await loadSiteContent();
    expect(content.payloadForPath("/ja/docs/design/")).toBe(
      content.documentForRoute("/docs/design"),
    );
  });

  it("localizes element text and accessible labels without changing structure", () => {
    const source =
      '<main><h1 data-i18n="title">English</h1><p data-i18n-label="label" aria-label="English">x</p></main>';
    expect(applyMessages(source, { title: "日本語", label: "説明" })).toBe(
      '<main><h1 data-i18n="title">日本語</h1><p aria-label="説明">x</p></main>',
    );
  });
});
