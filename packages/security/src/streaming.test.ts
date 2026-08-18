import { describe, expect, it } from "vitest";
import { computeSafePrefix, DEFAULT_QUOTAS, sanitizeHtml, StreamingSanitizer } from "./index.js";

/** Deterministic PRNG so a failing split is reproducible from its seed. */
function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function splitRandomly(text: string, seed: number): string[] {
  const random = createSeededRandom(seed);
  const chunks: string[] = [];
  let index = 0;
  while (index < text.length) {
    const size = 1 + Math.floor(random() * 6);
    chunks.push(text.slice(index, index + size));
    index += size;
  }
  return chunks;
}

const CORPUS: readonly string[] = [
  '<section class="card"><h1>Report</h1><p>Revenue is <strong>up 12%</strong>.</p></section>',
  "<div><p>a &amp; b</p><ul><li>one</li><li>two</li></ul></div>",
  "<article><h2>Title</h2><script>steal()</script><p>after</p></article>",
  "<div><style>body{background:url(https://evil.example)}</style><p>styled</p></div>",
  '<p>1 &lt; 2 &#38; 3</p><img src="https://example.com/a.png" alt="a">',
  '<div onclick="alert(1)"><a href="javascript:alert(1)">x</a><a href="https://ok.example">y</a></div>',
  "<!-- lead --><main><table><tr><td>c1</td><td>c2</td></tr></table></main>",
];

describe("computeSafePrefix", () => {
  it("should accept a complete document in full", () => {
    const html = "<div><p>done</p></div>";
    expect(computeSafePrefix(html)).toEqual({ length: html.length, pending: null });
  });

  it("should withhold a partially received tag", () => {
    const prefix = computeSafePrefix('<div><p>text</p><span class="a');
    expect(prefix.pending).toBe("open-tag");
    expect(prefix.length).toBe("<div><p>text</p>".length);
  });

  it("should withhold a bare trailing angle bracket that could become a tag", () => {
    expect(computeSafePrefix("<p>hi</p><")).toMatchObject({
      length: "<p>hi</p>".length,
      pending: "open-tag",
    });
  });

  it("should withhold a tag name that could still become a dangerous element", () => {
    // "<scr" must never be resolved as text: the next chunk may finish "<script>".
    const prefix = computeSafePrefix("<p>safe</p><scr");
    expect(prefix.length).toBe("<p>safe</p>".length);
    expect(prefix.pending).toBe("open-tag");
  });

  it("should withhold raw-text elements until their closing tag arrives", () => {
    const partial = "<p>before</p><script>let a = 1;";
    expect(computeSafePrefix(partial)).toMatchObject({
      length: "<p>before</p>".length,
      pending: "rawtext:script",
    });
    const closed = `${partial}</script><p>after</p>`;
    expect(computeSafePrefix(closed)).toEqual({ length: closed.length, pending: null });
  });

  it("should withhold an unterminated comment and declaration", () => {
    expect(computeSafePrefix("<p>a</p><!-- unfinished").pending).toBe("comment");
    expect(computeSafePrefix("<p>a</p><!doctype").pending).toBe("declaration");
  });

  it("should withhold an incomplete character reference at the tail", () => {
    expect(computeSafePrefix("<p>a &am")).toMatchObject({
      length: "<p>a ".length,
      pending: "entity",
    });
    expect(computeSafePrefix("<p>a &amp;")).toMatchObject({ pending: null });
  });

  it("should not split a surrogate pair", () => {
    const emoji = "🎨";
    const buffer = `<p>art ${emoji}`;
    expect(computeSafePrefix(buffer.slice(0, buffer.length - 1))).toMatchObject({
      pending: "surrogate",
    });
    expect(computeSafePrefix(buffer)).toMatchObject({ pending: null });
  });

  it("should treat an angle bracket that cannot start a tag as decided text", () => {
    expect(computeSafePrefix("<p>a < b</p>")).toMatchObject({ pending: null });
  });

  it("should withhold a tag whose attribute value is still open", () => {
    expect(computeSafePrefix('<a href="https://example.com/pa').pending).toBe("open-tag");
    // A ">" inside a quoted value does not terminate the tag.
    expect(computeSafePrefix('<a title="a > b"').pending).toBe("open-tag");
    expect(computeSafePrefix('<a title="a > b">').pending).toBeNull();
  });
});

describe("StreamingSanitizer — incremental safety", () => {
  it("should never emit an unclosed dangerous element while streaming", () => {
    const sanitizer = new StreamingSanitizer();
    let last = sanitizer.append("<p>intro</p><script>fetch('https://evil.example')");
    expect(last.status).toBe("streaming");
    expect(last.html).toBe("<p>intro</p>");
    expect(last.html).not.toContain("evil.example");

    last = sanitizer.append("</script><p>outro</p>");
    expect(last.html).toBe("<p>intro</p><p>outro</p>");
    expect(last.html).not.toContain("script");
  });

  it("should hold back a partial tag until it is complete", () => {
    const sanitizer = new StreamingSanitizer();
    expect(sanitizer.append('<p>a</p><div class="b').html).toBe("<p>a</p>");
    expect(sanitizer.append('ox">inside</div>').html).toBe('<p>a</p><div class="box">inside</div>');
  });

  it("should report why the tail is withheld", () => {
    const sanitizer = new StreamingSanitizer();
    const update = sanitizer.append("<p>text</p><tab");
    expect(update.pending).toBe("open-tag");
    expect(update.safeLength).toBe("<p>text</p>".length);
    expect(update.receivedLength).toBe("<p>text</p><tab".length);
  });

  it("should keep the received length current even when the boundary does not move", () => {
    const sanitizer = new StreamingSanitizer();
    sanitizer.append("<p>a</p><div ");
    const update = sanitizer.append('class="x"');
    expect(update.safeLength).toBe("<p>a</p>".length);
    expect(update.receivedLength).toBe('<p>a</p><div class="x"'.length);
  });
});

describe("StreamingSanitizer — completion and termination", () => {
  it("should sanitize the whole document on completion", () => {
    const sanitizer = new StreamingSanitizer();
    sanitizer.append("<div><p>partial");
    const final = sanitizer.complete();
    expect(final.status).toBe("complete");
    expect(final.html).toBe("<div><p>partial</p></div>");
    expect(final.pending).toBeNull();
  });

  it("should expose the raw source for durable storage", () => {
    const sanitizer = new StreamingSanitizer();
    sanitizer.append("<p>a</p>");
    sanitizer.append("<p>b</p>");
    expect(sanitizer.source).toBe("<p>a</p><p>b</p>");
  });

  it("should reject a stream that exceeds the source byte quota and stay rejected", () => {
    const sanitizer = new StreamingSanitizer({
      quotas: { ...DEFAULT_QUOTAS, maxSourceBytes: 32 },
    });
    expect(sanitizer.append("<p>short</p>").status).toBe("streaming");
    const rejected = sanitizer.append(`<p>${"x".repeat(200)}</p>`);
    expect(rejected.status).toBe("rejected");
    expect(rejected.violation?.quota).toBe("maxSourceBytes");
    expect(rejected.html).toBe("");
    // Later chunks cannot revive a rejected stream.
    expect(sanitizer.append("<p>more</p>").status).toBe("rejected");
    expect(sanitizer.complete().status).toBe("rejected");
  });

  it("should reject malformed markup consistently at prefix and completion", () => {
    const smuggled = '<img src="x" alt="q"onerror="alert(1)">';
    const sanitizer = new StreamingSanitizer();
    const streamed = sanitizer.append(smuggled);
    expect(streamed.status).toBe("rejected");
    expect(sanitizeHtml(smuggled).ok).toBe(false);
  });

  it("should return the completed result for repeated completion", () => {
    const sanitizer = new StreamingSanitizer();
    sanitizer.append("<p>a</p>");
    const first = sanitizer.complete();
    expect(sanitizer.complete()).toEqual(first);
  });
});

describe("StreamingSanitizer — properties across arbitrary chunk splits", () => {
  it("should match non-streaming sanitization for every seeded split", () => {
    for (const document of CORPUS) {
      const expected = sanitizeHtml(document);
      expect(expected.ok, document).toBe(true);
      for (const seed of [1, 2, 3, 5, 8, 13]) {
        const sanitizer = new StreamingSanitizer();
        for (const chunk of splitRandomly(document, seed)) sanitizer.append(chunk);
        const final = sanitizer.complete();
        expect(final.status, `seed=${seed} ${document}`).toBe("complete");
        if (expected.ok) {
          expect(final.html, `seed=${seed} ${document}`).toBe(expected.html);
        }
      }
    }
  });

  it("should advance the safety boundary monotonically", () => {
    for (const document of CORPUS) {
      for (const seed of [4, 7, 11]) {
        const sanitizer = new StreamingSanitizer();
        let previous = 0;
        for (const chunk of splitRandomly(document, seed)) {
          const update = sanitizer.append(chunk);
          expect(update.safeLength, `seed=${seed}`).toBeGreaterThanOrEqual(previous);
          expect(update.safeLength).toBeLessThanOrEqual(update.receivedLength);
          previous = update.safeLength;
        }
      }
    }
  });

  it("should never leak script or handler content through an intermediate render", () => {
    const hostile =
      '<p>ok</p><script>document.cookie</script><div onclick="steal()">x</div>' +
      '<style>@import "https://evil.example"</style><p>end</p>';
    for (const seed of [1, 6, 9, 17]) {
      const sanitizer = new StreamingSanitizer();
      for (const chunk of splitRandomly(hostile, seed)) {
        const update = sanitizer.append(chunk);
        expect(update.html, `seed=${seed}`).not.toContain("cookie");
        expect(update.html).not.toContain("steal");
        expect(update.html).not.toContain("evil.example");
        expect(update.html).not.toContain("onclick");
      }
      const final = sanitizer.complete();
      expect(final.html).toBe("<p>ok</p><div>x</div><p>end</p>");
    }
  });

  it("should keep every intermediate render a valid sanitizer output", () => {
    for (const document of CORPUS) {
      const sanitizer = new StreamingSanitizer();
      for (const chunk of splitRandomly(document, 21)) {
        const update = sanitizer.append(chunk);
        if (update.status !== "streaming") continue;
        // Re-sanitizing an already sanitized fragment must be a no-op.
        const again = sanitizeHtml(update.html);
        expect(again.ok, document).toBe(true);
        if (again.ok) expect(again.html).toBe(update.html);
      }
    }
  });
});
