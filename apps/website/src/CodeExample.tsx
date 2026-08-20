import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { tokenizeTypeScriptLine } from "./typescript-highlighter";

export interface CodeExampleLabels {
  readonly collapse: string;
  readonly copied: string;
  readonly copy: string;
  readonly expand: string;
}

export function CodeExample({
  code,
  labels,
  collapsedLines = 7,
}: {
  readonly code: string;
  readonly labels: CodeExampleLabels;
  readonly collapsedLines?: number;
}): ReactNode {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lines = code.split("\n");
  const collapsible = lines.length > collapsedLines;
  const style = { "--code-collapsed-lines": collapsedLines } as CSSProperties;

  useEffect(
    () => () => {
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    },
    [],
  );

  const copyCode = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => {
        setCopied(false);
      }, 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="code-example" aria-label="TypeScript example">
      <header className="code-example__toolbar">
        <span className="code-example__dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="code-example__language">TypeScript</span>
        <button
          type="button"
          className="code-example__copy"
          onClick={() => {
            void copyCode();
          }}
        >
          <span aria-hidden="true">{copied ? "✓" : "⧉"}</span>
          {copied ? labels.copied : labels.copy}
        </button>
      </header>

      <div
        className={`code-example__viewport${collapsible && !expanded ? " is-collapsed" : ""}`}
        style={style}
      >
        <pre tabIndex={0}>
          <code>
            {lines.map((line, lineIndex) => (
              <span className="code-example__line" key={lineIndex}>
                <span className="code-example__line-number" aria-hidden="true">
                  {lineIndex + 1}
                </span>
                <span className="code-example__line-source">
                  {line.length === 0
                    ? "\u200b"
                    : tokenizeTypeScriptLine(line).map((token, tokenIndex) => (
                        <span className={`code-token--${token.kind}`} key={tokenIndex}>
                          {token.value}
                        </span>
                      ))}
                </span>
              </span>
            ))}
          </code>
        </pre>
      </div>

      {collapsible && (
        <button
          type="button"
          className="code-example__toggle"
          aria-expanded={expanded}
          onClick={() => {
            setExpanded((value) => !value);
          }}
        >
          <span aria-hidden="true">{expanded ? "↑" : "↓"}</span>
          {expanded ? labels.collapse : labels.expand}
          <span className="code-example__line-count">{lines.length}</span>
        </button>
      )}
    </section>
  );
}
