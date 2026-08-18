import { describe, expect, it } from "vitest";
import {
  compileCode,
  compileError,
  compileHtmlProfile,
  compileLoading,
  compileMedia,
  DEFAULT_STATUS_THEME,
  compileJson,
  compileMarkdown,
  compileRows,
  compileText,
  DEFAULT_THEME,
  highlightCodeLine,
  layoutBlocks,
  parseInline,
  type Block,
  type InlineRun,
  type TextStyle,
} from "./index.js";

/** Deterministic monospace metrics so layout assertions are exact. */
const measure = (text: string, style: TextStyle): number => text.length * style.size * 0.6;

function textOf(runs: readonly InlineRun[]): string {
  return runs.map((run) => run.text).join("");
}

function allRuns(blocks: readonly Block[]): InlineRun[] {
  return blocks.flatMap((block) => {
    if (block.type === "row") return block.cells.flat();
    if (block.type === "media") return [...block.caption];
    if (block.type === "spacer" || block.type === "skeleton") return [];
    return [...block.runs];
  });
}

describe("parseInline", () => {
  it("should render bold, italic, inline code, and links as styled runs", () => {
    const runs = parseInline(
      "Revenue is **up 12%** and _steady_ with `growth()` — see [plan](https://x.example)",
      DEFAULT_THEME,
    );
    const bold = runs.find((run) => run.style.weight === 700);
    const italic = runs.find((run) => run.style.italic);
    const code = runs.find((run) => run.style.family === "mono");
    const link = runs.find((run) => run.style.underline === true);
    expect(bold?.text).toBe("up 12%");
    expect(italic?.text).toBe("steady");
    expect(code?.text).toBe("growth()");
    expect(link?.text).toBe("plan");
    expect(link?.style.color).toBe(DEFAULT_THEME.link);
  });

  it("should drop the markup characters from the rendered text", () => {
    expect(textOf(parseInline("**bold**", DEFAULT_THEME))).toBe("bold");
    expect(textOf(parseInline("[label](https://example.com)", DEFAULT_THEME))).toBe("label");
  });

  it("should pass plain text through unchanged", () => {
    expect(textOf(parseInline("no markup here", DEFAULT_THEME))).toBe("no markup here");
  });
});

describe("highlightCodeLine", () => {
  it("should colour keywords, strings, numbers, and comments differently", () => {
    const runs = highlightCodeLine('const total = 42; // "note"', DEFAULT_THEME);
    const keyword = runs.find((run) => run.text === "const");
    const number = runs.find((run) => run.text === "42");
    const comment = runs.find((run) => run.text.startsWith("//"));
    expect(keyword?.style.color).toBe(DEFAULT_THEME.keyword);
    expect(number?.style.color).toBe(DEFAULT_THEME.number);
    expect(comment?.style.color).toBe(DEFAULT_THEME.comment);
    expect(comment?.style.italic).toBe(true);
  });

  it("should preserve the source text exactly", () => {
    const line = "  return (next - prev) / prev;";
    expect(textOf(highlightCodeLine(line, DEFAULT_THEME))).toBe(line);
  });

  it("should render every run in a monospace family", () => {
    for (const run of highlightCodeLine("if (a === 1) throw new Error('x');", DEFAULT_THEME)) {
      expect(run.style.family).toBe("mono");
    }
  });
});

describe("compileMarkdown", () => {
  const source =
    "## Q3 summary\n\nRevenue reached **$4.2M**.\n\n- Enterprise renewals\n- Self-serve\n\n```ts\nconst a = 1;\n```\n";

  it("should produce headings, paragraphs, list items, and highlighted code lines", () => {
    const blocks = compileMarkdown(source);
    expect(blocks.map((block) => block.type)).toEqual([
      "heading",
      "paragraph",
      "listItem",
      "listItem",
      "codeLine",
    ]);
  });

  it("should size headings above body text", () => {
    const [heading] = compileMarkdown("# Title");
    const runs = heading?.type === "heading" ? heading.runs : [];
    expect(runs[0]?.style.size).toBeGreaterThan(DEFAULT_THEME.baseSize);
    expect(runs[0]?.style.weight).toBe(700);
  });

  it("should not leak markup characters into rendered text", () => {
    const rendered = textOf(allRuns(compileMarkdown(source)));
    expect(rendered).not.toContain("**");
    expect(rendered).not.toContain("##");
    expect(rendered).toContain("$4.2M");
  });

  it("should highlight fenced code instead of showing the fence", () => {
    const blocks = compileMarkdown(source);
    const code = blocks.find((block) => block.type === "codeLine");
    expect(code && textOf(code.runs)).toBe("const a = 1;");
  });
});

describe("compileJson", () => {
  it("should format and highlight properties, strings, and numbers", () => {
    const blocks = compileJson('{"segment":"Enterprise","growth":0.18,"active":true}');
    expect(blocks.length).toBeGreaterThan(1); // formatted across lines
    const runs = allRuns(blocks);
    expect(runs.find((run) => run.text.includes('"segment"'))?.style.color).toBe(
      DEFAULT_THEME.property,
    );
    expect(runs.find((run) => run.text === '"Enterprise"')?.style.color).toBe(DEFAULT_THEME.string);
    expect(runs.find((run) => run.text === "0.18")?.style.color).toBe(DEFAULT_THEME.number);
    expect(runs.find((run) => run.text === "true")?.style.color).toBe(DEFAULT_THEME.keyword);
  });

  it("should fall back to plain monospace for input it cannot parse", () => {
    const blocks = compileJson('{"segment":"Enterp');
    expect(textOf(allRuns(blocks))).toBe('{"segment":"Enterp');
  });
});

describe("compileRows", () => {
  it("should build a table with a header row", () => {
    const blocks = compileRows("segment,revenue\nEnterprise,2400000\n");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.type === "row" && blocks[0].header).toBe(true);
    expect(blocks[1]?.type === "row" && blocks[1].header).toBe(false);
    expect(blocks[1]?.type === "row" && blocks[1].cells).toHaveLength(2);
  });

  it("should ignore blank trailing lines", () => {
    expect(compileRows("a,b\n1,2\n\n")).toHaveLength(2);
  });
});

describe("compileHtmlProfile", () => {
  const html =
    "<section><h3>Q3 revenue</h3><p>Up <strong>12%</strong> QoQ.</p>" +
    "<ul><li>Enterprise</li></ul>" +
    "<table><tr><th>Segment</th><th>Growth</th></tr><tr><td>Ent</td><td>18%</td></tr></table></section>";

  it("should render the supported profile as blocks rather than markup", () => {
    const blocks = compileHtmlProfile(html);
    expect(blocks.map((block) => block.type)).toEqual([
      "heading",
      "paragraph",
      "listItem",
      "row",
      "row",
    ]);
    expect(textOf(allRuns(blocks))).not.toContain("<");
  });

  it("should carry inline emphasis into run styles", () => {
    const runs = allRuns(compileHtmlProfile(html));
    expect(runs.find((run) => run.text === "12%")?.style.weight).toBe(700);
  });

  it("should mark a header row so the table draws a rule", () => {
    const rows = compileHtmlProfile(html).filter((block) => block.type === "row");
    expect(rows[0]?.type === "row" && rows[0].header).toBe(true);
    expect(rows[1]?.type === "row" && rows[1].header).toBe(false);
  });

  it("should decode escaped entities back to characters", () => {
    expect(textOf(allRuns(compileHtmlProfile("<p>1 &lt; 2 &amp; 3</p>")))).toBe("1 < 2 & 3");
  });
});

describe("compileText", () => {
  it("should split on blank lines and join wrapped lines", () => {
    const blocks = compileText("First para\nsecond line\n\nNext para");
    expect(blocks).toHaveLength(2);
    expect(textOf(allRuns(blocks.slice(0, 1)))).toBe("First para second line");
  });
});

describe("layoutBlocks", () => {
  it("should wrap a paragraph within the frame width", () => {
    const blocks = compileText("alpha beta gamma delta epsilon");
    const list = layoutBlocks(blocks, { width: 60, measure });
    const lines = new Set(list.runs.map((run) => run.y));
    expect(lines.size).toBeGreaterThan(1);
    expect(list.height).toBeGreaterThan(0);
    for (const run of list.runs) expect(run.x).toBeLessThan(60);
  });

  it("should never wrap a code line, clipping instead", () => {
    const list = layoutBlocks(compileCode("const veryLongIdentifier = anotherLongIdentifier;"), {
      width: 40,
      measure,
    });
    expect(new Set(list.runs.map((run) => run.y)).size).toBe(1);
  });

  it("should align table columns and rule off the header", () => {
    const list = layoutBlocks(compileRows("segment,revenue\nEnterprise,2400000\nSelf,1100000\n"), {
      width: 300,
      measure,
    });
    const columnXs = [...new Set(list.runs.map((run) => run.x))];
    expect(columnXs).toHaveLength(2);
    expect(list.rules).toHaveLength(1);
  });

  it("should advance vertically for every block", () => {
    const short = layoutBlocks(compileText("one"), { width: 200, measure });
    const long = layoutBlocks(compileText("one\n\ntwo\n\nthree"), { width: 200, measure });
    expect(long.height).toBeGreaterThan(short.height);
  });

  it("should indent list items past their bullet", () => {
    const list = layoutBlocks(compileMarkdown("- item text"), { width: 200, measure });
    const bullet = list.runs[0];
    const first = list.runs[1];
    expect(bullet?.text).toBe("• ");
    expect(first?.x).toBeGreaterThan(bullet?.x ?? 0);
  });

  it("should produce identical geometry for identical input", () => {
    const blocks = compileMarkdown("## Title\n\nBody **bold** text\n\n- one\n- two\n");
    const a = layoutBlocks(blocks, { width: 220, measure });
    const b = layoutBlocks(blocks, { width: 220, measure });
    expect(a).toEqual(b);
  });
});

describe("compileLoading", () => {
  it("should show skeleton bars for text-like kinds", () => {
    const blocks = compileLoading({ kind: "markdown" });
    expect(blocks[0]?.type).toBe("skeleton");
    const list = layoutBlocks(blocks, { width: 200, measure });
    expect(list.rects.length).toBeGreaterThan(1);
    // Uneven widths: a uniform block would read as a rendering bug.
    expect(new Set(list.rects.map((rect) => rect.width)).size).toBeGreaterThan(1);
  });

  it("should reserve a media box instead of skeleton text", () => {
    for (const kind of ["image", "video"] as const) {
      const blocks = compileLoading({ kind });
      expect(blocks).toHaveLength(1);
      expect(blocks[0]?.type).toBe("media");
    }
  });

  it("should give video a wider default box than an image", () => {
    const aspectOf = (block: Block | undefined): number =>
      block?.type === "media" ? block.aspect : 0;
    expect(aspectOf(compileLoading({ kind: "video" })[0])).toBeGreaterThan(
      aspectOf(compileLoading({ kind: "image" })[0]),
    );
  });

  it("should draw a determinate progress track only when a ratio is known", () => {
    const measured = layoutBlocks(compileLoading({ kind: "image", progress: 0.5 }), {
      width: 200,
      measure,
    });
    const indeterminate = layoutBlocks(compileLoading({ kind: "image" }), { width: 200, measure });
    expect(measured.rects).toHaveLength(2);
    expect(indeterminate.rects).toHaveLength(1);
  });

  it("should clamp a progress ratio outside 0 to 1", () => {
    const over = layoutBlocks(compileLoading({ kind: "image", progress: 4 }), {
      width: 200,
      measure,
    });
    expect(over.rects[1]?.width).toBeLessThanOrEqual(over.rects[0]?.width ?? 0);
  });

  it("should name what is being waited on", () => {
    expect(textOf(allRuns(compileLoading({ kind: "json" })))).toContain("json");
    expect(textOf(allRuns(compileLoading({ kind: "image", label: "fetching poster" })))).toBe(
      "fetching poster",
    );
  });
});

describe("compileMedia", () => {
  it("should carry the intrinsic aspect ratio once known", () => {
    const [block] = compileMedia("image", { width: 800, height: 400 });
    expect(block?.type === "media" && block.aspect).toBe(2);
  });

  it("should caption the intrinsic size and video duration", () => {
    expect(textOf(allRuns(compileMedia("image", { width: 800, height: 400 })))).toBe(
      "image 800×400",
    );
    expect(
      textOf(allRuns(compileMedia("video", { width: 1920, height: 1080, durationMs: 12500 }))),
    ).toBe("video 1920×1080 · 12.5s");
  });

  it("should fall back to a default ratio for degenerate dimensions", () => {
    const [block] = compileMedia("video", { width: 0, height: 0 });
    expect(block?.type === "media" && block.aspect).toBeGreaterThan(1);
  });

  it("should not draw a progress track once resolved", () => {
    const list = layoutBlocks(compileMedia("image", { width: 100, height: 100 }), {
      width: 200,
      measure,
    });
    expect(list.rects).toHaveLength(1);
  });
});

describe("compileError", () => {
  it("should show the message and the typed code", () => {
    const rendered = textOf(allRuns(compileError({ code: "decode-failed", message: "bad JPEG" })));
    expect(rendered).toContain("bad JPEG");
    expect(rendered).toContain("decode-failed");
  });

  it("should say whether retrying could help", () => {
    expect(textOf(allRuns(compileError({ code: "x", message: "m" })))).toContain("can retry");
    expect(
      textOf(allRuns(compileError({ code: "x", message: "m", recoverable: false }))),
    ).not.toContain("can retry");
  });

  it("should colour the heading as a failure", () => {
    const heading = compileError({ code: "x", message: "m" })[0];
    const runs = heading?.type === "paragraph" ? heading.runs : [];
    expect(runs[0]?.style.color).toBe(DEFAULT_STATUS_THEME.danger);
  });
});
