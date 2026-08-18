import { describe, expect, it } from "vitest";
import {
  codeSegmenter,
  completeJsonPrefix,
  jsonSegmenter,
  markdownSegmenter,
  rowsSegmenter,
  textSegmenter,
} from "./index.js";

function commit(buffer: string, segmenter: (input: string) => { committedLength: number }): string {
  return buffer.slice(0, segmenter(buffer).committedLength);
}

describe("textSegmenter", () => {
  it("should commit plain text as it arrives", () => {
    expect(textSegmenter("Revenue reached")).toEqual({
      committedLength: "Revenue reached".length,
      pending: null,
    });
  });

  it("should not split a surrogate pair", () => {
    const full = "chart 📈";
    expect(textSegmenter(full.slice(0, full.length - 1))).toMatchObject({ pending: "surrogate" });
    expect(textSegmenter(full)).toMatchObject({ pending: null });
  });

  it("should withhold a trailing joiner that promises more of the cluster", () => {
    expect(textSegmenter("team 👩‍").pending).toBe("grapheme");
  });

  it("should handle an empty buffer", () => {
    expect(textSegmenter("")).toEqual({ committedLength: 0, pending: null });
  });
});

describe("codeSegmenter", () => {
  it("should commit only complete lines", () => {
    expect(commit("const a = 1;\nconst b = ", codeSegmenter)).toBe("const a = 1;\n");
  });

  it("should commit everything when the buffer ends on a line break", () => {
    const code = "const a = 1;\n";
    expect(codeSegmenter(code)).toEqual({ committedLength: code.length, pending: null });
  });

  it("should withhold a first line that has not ended", () => {
    expect(codeSegmenter("const a")).toEqual({ committedLength: 0, pending: "partial-line" });
  });
});

describe("rowsSegmenter", () => {
  it("should commit whole rows only", () => {
    const rows = "id,name\n1,Ada\n2,Gr";
    expect(commit(rows, rowsSegmenter)).toBe("id,name\n1,Ada\n");
  });
});

describe("markdownSegmenter", () => {
  it("should let a paragraph grow character by character", () => {
    expect(markdownSegmenter("Revenue grew by")).toMatchObject({ pending: null });
  });

  it("should withhold an unterminated fenced block", () => {
    const buffer = "Intro\n\n```ts\nconst a = 1;";
    expect(commit(buffer, markdownSegmenter)).toBe("Intro\n\n");
    expect(markdownSegmenter(buffer).pending).toBe("open-fence");
  });

  it("should commit a fenced block once it closes", () => {
    const buffer = "Intro\n\n```ts\nconst a = 1;\n```\n";
    expect(markdownSegmenter(buffer)).toMatchObject({
      committedLength: buffer.length,
      pending: null,
    });
  });

  it("should withhold a link whose target is still arriving", () => {
    const buffer = "See the [delivery plan](https://exam";
    expect(commit(buffer, markdownSegmenter)).toBe("See the ");
    expect(markdownSegmenter(buffer).pending).toBe("open-link");
  });

  it("should commit a link once it closes", () => {
    const buffer = "See the [plan](https://example.com) for gates.";
    expect(markdownSegmenter(buffer)).toMatchObject({ pending: null });
  });

  it("should withhold dangling emphasis and inline code", () => {
    expect(commit("Revenue is **up 12", markdownSegmenter)).toBe("Revenue is ");
    expect(commit("Call `render", markdownSegmenter)).toBe("Call ");
    expect(markdownSegmenter("Revenue is **up 12%** now")).toMatchObject({ pending: null });
  });

  it("should not treat markers on earlier lines as open", () => {
    const buffer = "Line **one** done\nLine two still going";
    expect(markdownSegmenter(buffer)).toMatchObject({ pending: null });
  });
});

describe("jsonSegmenter", () => {
  it("should commit a complete document in full", () => {
    const json = '{"a":1,"b":[2,3]}';
    expect(jsonSegmenter(json)).toEqual({ committedLength: json.length, pending: null });
  });

  it("should commit only completed array elements", () => {
    const buffer = '[{"id":1},{"id":2},{"id":';
    expect(commit(buffer, jsonSegmenter)).toBe('[{"id":1},{"id":2}');
    expect(jsonSegmenter(buffer).pending).toBe("incomplete-value");
  });

  it("should not commit a number that could still gain digits", () => {
    const buffer = '{"total":12';
    expect(commit(buffer, jsonSegmenter)).toBe("");
  });

  it("should ignore braces and commas inside strings", () => {
    const buffer = '[{"note":"a, b {c}"},{"note":"x';
    expect(commit(buffer, jsonSegmenter)).toBe('[{"note":"a, b {c}"}');
  });

  it("should respect escaped quotes", () => {
    const buffer = '[{"note":"say \\"hi\\""},{"n';
    expect(commit(buffer, jsonSegmenter)).toBe('[{"note":"say \\"hi\\""}');
  });
});

describe("completeJsonPrefix", () => {
  it("should close open structures so a partial stream parses", () => {
    const buffer = '[{"id":1},{"id":2},{"id":';
    const partial = completeJsonPrefix(commit(buffer, jsonSegmenter));
    expect(partial).toBe('[{"id":1},{"id":2}]');
    expect(JSON.parse(partial)).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("should leave a complete document untouched", () => {
    const json = '{"a":[1,2]}';
    expect(completeJsonPrefix(json)).toBe(json);
  });

  it("should produce parseable output at every boundary of a streamed document", () => {
    const document = '{"rows":[{"id":1,"name":"Ada"},{"id":2,"name":"Grace"}],"total":2}';
    for (let cut = 1; cut <= document.length; cut += 1) {
      const buffer = document.slice(0, cut);
      const committed = commit(buffer, jsonSegmenter);
      if (committed.length === 0) continue;
      const repaired = completeJsonPrefix(committed);
      expect(() => {
        JSON.parse(repaired);
      }, `cut=${cut} → ${repaired}`).not.toThrow();
    }
  });
});

describe("segmenter invariants", () => {
  const SEGMENTERS = [
    ["text", textSegmenter],
    ["code", codeSegmenter],
    ["markdown", markdownSegmenter],
    ["json", jsonSegmenter],
    ["rows", rowsSegmenter],
  ] as const;

  const SAMPLES = [
    "Revenue reached $4.2M this quarter.\nSecond line still going",
    "# Title\n\nBody with **bold** and a [link](https://example.com).\n\n```ts\nconst a = 1;\n```\n",
    '{"rows":[{"id":1},{"id":2}],"total":2}',
    "id,name\n1,Ada\n2,Grace\n",
  ];

  it("should never commit more than the buffer holds", () => {
    for (const [name, segmenter] of SEGMENTERS) {
      for (const sample of SAMPLES) {
        for (let cut = 0; cut <= sample.length; cut += 1) {
          const slice = segmenter(sample.slice(0, cut));
          expect(slice.committedLength, `${name} cut=${cut}`).toBeGreaterThanOrEqual(0);
          expect(slice.committedLength, `${name} cut=${cut}`).toBeLessThanOrEqual(cut);
        }
      }
    }
  });

  it("should advance monotonically as the buffer grows", () => {
    for (const [name, segmenter] of SEGMENTERS) {
      for (const sample of SAMPLES) {
        let previous = 0;
        for (let cut = 0; cut <= sample.length; cut += 1) {
          const { committedLength } = segmenter(sample.slice(0, cut));
          expect(committedLength, `${name} cut=${cut}`).toBeGreaterThanOrEqual(previous);
          previous = committedLength;
        }
      }
    }
  });

  it("should commit the whole buffer for a finished document", () => {
    expect(textSegmenter(SAMPLES[0] as string).pending).toBeNull();
    expect(markdownSegmenter(SAMPLES[1] as string).pending).toBeNull();
    expect(jsonSegmenter(SAMPLES[2] as string).pending).toBeNull();
    expect(rowsSegmenter(SAMPLES[3] as string).pending).toBeNull();
  });
});
