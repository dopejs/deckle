import { describe, expect, it } from "vitest";
import { StreamingSanitizer } from "@dopejs/deckle-security";

import {
  advanceStreamingCanvasSession,
  DEMO_AGENT_OUTPUT,
  newStreamingCanvasSession,
  STREAMING_CARD_SPECS,
  streamingCanvasViewOf,
  tokenizeDemoStream,
} from "./streaming-demo-model";

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

  it("announces indexed cards before their content streams settle", () => {
    const session = newStreamingCanvasSession();
    advanceStreamingCanvasSession(session, 1);

    expect(session.cards).toHaveLength(1);
    const card = session.cards[0]!;
    const center = {
      x: card.spec.frame.x + card.spec.frame.width / 2,
      y: card.spec.frame.y + card.spec.frame.height / 2,
    };
    expect(session.store.queryPoint(center.x, center.y)).toContain(card.spec.id);
    expect(session.store.get(card.handle).lifecycle).toBe("loading");
    expect(session.store.get(card.handle).pins).toContain("loading");
  });

  it("loads independent card streams and commits every card", () => {
    const session = newStreamingCanvasSession();
    let guard = 0;
    while (advanceStreamingCanvasSession(session, 28) && guard < 1_000) guard += 1;

    const view = streamingCanvasViewOf(session);
    expect(guard).toBeLessThan(1_000);
    expect(view.announced).toBe(STREAMING_CARD_SPECS.length);
    expect(view.committed).toBe(STREAMING_CARD_SPECS.length);
    expect(view.pinned).toBe(0);
    expect(view.diagnostics).toBe(2);
    expect(view.complete).toBe(true);
  });
});
