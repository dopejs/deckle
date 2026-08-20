import { describe, expect, it } from "vitest";
import { StreamingSanitizer } from "@dopejs/deckle-security";

import { DEMO_AGENT_OUTPUT, tokenizeDemoStream } from "./StreamingDemo";

describe("tokenizeDemoStream", () => {
  it("round-trips the input through uneven non-empty chunks", () => {
    const source = "<section><strong>hello</strong></section>";
    const chunks = tokenizeDemoStream(source);

    expect(chunks.join("")).toBe(source);
    expect(chunks.every((chunk) => chunk.length > 0)).toBe(true);
    expect(new Set(chunks.map((chunk) => chunk.length)).size).toBeGreaterThan(1);
  });

  it("keeps executable markup out of the rendered demo output", () => {
    const sanitizer = new StreamingSanitizer();
    for (const chunk of tokenizeDemoStream(DEMO_AGENT_OUTPUT)) sanitizer.append(chunk);
    const result = sanitizer.complete();

    expect(result.status).toBe("complete");
    expect(result.html).not.toContain("<script");
    expect(result.html).not.toContain("onclick");
    expect(result.diagnostics).toHaveLength(2);
  });
});
