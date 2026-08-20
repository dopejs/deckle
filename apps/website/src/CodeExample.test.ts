import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { CodeExample } from "./CodeExample";
import { tokenizeTypeScriptLine } from "./typescript-highlighter";

describe("TypeScript example highlighting", () => {
  it("separates keywords, classes, strings, and comments without changing source", () => {
    const source = 'const store = new SceneStore("demo"); // retained scene';
    const tokens = tokenizeTypeScriptLine(source);

    expect(tokens.map((token) => token.value).join("")).toBe(source);
    expect(tokens).toEqual(
      expect.arrayContaining([
        { kind: "keyword", value: "const" },
        { kind: "keyword", value: "new" },
        { kind: "class", value: "SceneStore" },
        { kind: "string", value: '"demo"' },
        { kind: "comment", value: "// retained scene" },
      ]),
    );
  });

  it("keeps escaped quotes inside a string token", () => {
    const source = 'const value = "a \\"quoted\\" value";';
    const tokens = tokenizeTypeScriptLine(source);

    expect(tokens.map((token) => token.value).join("")).toBe(source);
    expect(tokens.filter((token) => token.kind === "string")).toHaveLength(1);
  });

  it("renders line numbers and starts long examples collapsed", () => {
    const markup = renderToStaticMarkup(
      createElement(CodeExample, {
        code: ["const one = 1;", "const two = 2;", "const three = 3;"].join("\n"),
        collapsedLines: 2,
        labels: { collapse: "Collapse", copied: "Copied", copy: "Copy", expand: "Expand" },
      }),
    );

    expect(markup).toContain("is-collapsed");
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("code-example__line-number");
    expect(markup).toContain("Expand");
  });
});
