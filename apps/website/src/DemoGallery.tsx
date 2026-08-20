import { useState, type ReactNode } from "react";

import { InfiniteCanvasDemo } from "./demos/InfiniteCanvasDemo";
import { InteractionDemo } from "./demos/InteractionDemo";
import { StreamingDemo } from "./demos/StreamingDemo";
import type { SiteMessages } from "./types";

type DemoId = "canvas" | "interaction" | "streaming";

function copy(messages: SiteMessages, key: string, fallback: string): string {
  return messages[key] ?? fallback;
}

export function DemoGallery({ messages }: { readonly messages: SiteMessages }): ReactNode {
  const [active, setActive] = useState<DemoId>("canvas");
  const demos = [
    {
      id: "canvas" as const,
      number: "01",
      title: copy(messages, "demos.canvas.title", "500 artifacts, viewport-sized work"),
      description: copy(
        messages,
        "demos.canvas.description",
        "Pan, zoom, and select across a deterministic 500-artifact scene. The HUD is driven by the real spatial index, visibility tracker, and LOD policy.",
      ),
      hint: copy(
        messages,
        "demos.canvas.hint",
        "Drag to pan · click to select · trackpad or wheel to move · Ctrl/⌘ + wheel to zoom",
      ),
    },
    {
      id: "interaction" as const,
      number: "02",
      title: copy(messages, "demos.interaction.title", "Selection without a live DOM"),
      description: copy(
        messages,
        "demos.interaction.description",
        "Click through a retained interaction tree with nested transforms, clipping, and paint order. The optimized tester is checked against the naive oracle on every probe.",
      ),
      hint: copy(
        messages,
        "demos.interaction.hint",
        "Repeated clicks enter the hierarchy · Escape moves back to the parent",
      ),
    },
    {
      id: "streaming" as const,
      number: "03",
      title: copy(messages, "demos.streaming.title", "Safe output while generation is incomplete"),
      description: copy(
        messages,
        "demos.streaming.description",
        "Watch unsafe HTML arrive in uneven token chunks. Only a decided, sanitized prefix is rendered while lifecycle pins and correlated revisions advance.",
      ),
      hint: copy(
        messages,
        "demos.streaming.hint",
        "Amber text is withheld · scripts and event handlers never reach the rendered output",
      ),
    },
  ] as const;
  const current = demos.find((demo) => demo.id === active) ?? demos[0];

  return (
    <main className="demo-gallery">
      <header className="demo-gallery__intro">
        <p className="eyebrow">{copy(messages, "demos.eyebrow", "Interactive evidence")}</p>
        <h1>{copy(messages, "demos.title", "Deckle, running in the page")}</h1>
        <p>
          {copy(
            messages,
            "demos.lede",
            "These focused scenes exercise the same engine contracts shipped by the workspace—without an embedded development tool or a simulated product UI.",
          )}
        </p>
        <p className="demo-gallery__scope">
          {copy(
            messages,
            "demos.scope",
            "Interactive proof, not benchmark or browser-compatibility evidence.",
          )}
        </p>
      </header>

      <nav className="demo-tabs" role="tablist" aria-label="Deckle demo scenarios">
        {demos.map((demo) => (
          <button
            key={demo.id}
            id={`demo-tab-${demo.id}`}
            type="button"
            role="tab"
            aria-selected={demo.id === active}
            aria-controls={`demo-panel-${demo.id}`}
            tabIndex={demo.id === active ? 0 : -1}
            onClick={() => {
              setActive(demo.id);
            }}
          >
            <span>{demo.number}</span>
            {demo.title}
          </button>
        ))}
      </nav>

      <article
        id={`demo-panel-${current.id}`}
        className="demo-panel"
        role="tabpanel"
        aria-labelledby={`demo-tab-${current.id}`}
      >
        <header className="demo-panel__header">
          <div>
            <p className="demo-panel__number">SCENE {current.number}</p>
            <h2>{current.title}</h2>
            <p>{current.description}</p>
          </div>
          <span className="demo-panel__badge">
            {copy(messages, "demos.realEngine", "real engine")}
          </span>
        </header>

        {active === "canvas" && <InfiniteCanvasDemo />}
        {active === "interaction" && <InteractionDemo />}
        {active === "streaming" && (
          <StreamingDemo
            labels={{
              play: copy(messages, "demos.play", "Stream"),
              pause: copy(messages, "demos.pause", "Pause"),
              step: copy(messages, "demos.step", "Step"),
              reset: copy(messages, "demos.reset", "Reset"),
              speed: copy(messages, "demos.speed", "Delay"),
              source: copy(messages, "demos.source", "Incoming source"),
              output: copy(messages, "demos.output", "Sanitized output"),
            }}
          />
        )}

        <p className="demo-panel__hint">{current.hint}</p>
      </article>
    </main>
  );
}
