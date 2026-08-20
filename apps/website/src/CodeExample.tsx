import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

const KEYWORDS = new Set([
  "as",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "default",
  "delete",
  "do",
  "else",
  "export",
  "extends",
  "finally",
  "for",
  "from",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "new",
  "of",
  "return",
  "switch",
  "throw",
  "try",
  "type",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

const LITERALS = new Set(["false", "null", "true", "undefined"]);

type TokenKind =
  "class" | "comment" | "function" | "keyword" | "literal" | "number" | "plain" | "string";

export interface CodeToken {
  readonly kind: TokenKind;
  readonly value: string;
}

function isIdentifierStart(character: string): boolean {
  return /[A-Za-z_$]/u.test(character);
}

function isIdentifierPart(character: string): boolean {
  return /[\w$]/u.test(character);
}

/** A deliberately small TypeScript lexer for the static, dependency-free website examples. */
export function tokenizeTypeScriptLine(line: string): readonly CodeToken[] {
  const tokens: CodeToken[] = [];
  let index = 0;
  const push = (kind: TokenKind, value: string): void => {
    const previous = tokens.at(-1);
    if (previous?.kind === kind) {
      tokens[tokens.length - 1] = { kind, value: previous.value + value };
    } else {
      tokens.push({ kind, value });
    }
  };

  while (index < line.length) {
    if (line.startsWith("//", index)) {
      push("comment", line.slice(index));
      break;
    }

    const character = line[index]!;
    if (character === '"' || character === "'" || character === "`") {
      const quote = character;
      let end = index + 1;
      while (end < line.length) {
        if (line[end] === "\\") {
          end += 2;
          continue;
        }
        if (line[end] === quote) {
          end += 1;
          break;
        }
        end += 1;
      }
      push("string", line.slice(index, end));
      index = end;
      continue;
    }

    if (/\d/u.test(character)) {
      const match = line.slice(index).match(/^\d+(?:\.\d+)?/u)![0];
      push("number", match);
      index += match.length;
      continue;
    }

    if (isIdentifierStart(character)) {
      let end = index + 1;
      while (end < line.length && isIdentifierPart(line[end]!)) end += 1;
      const value = line.slice(index, end);
      const rest = line.slice(end);
      const kind: TokenKind = KEYWORDS.has(value)
        ? "keyword"
        : LITERALS.has(value)
          ? "literal"
          : /^[A-Z]/u.test(value)
            ? "class"
            : /^\s*\(/u.test(rest)
              ? "function"
              : "plain";
      push(kind, value);
      index = end;
      continue;
    }

    push("plain", character);
    index += 1;
  }

  return tokens;
}

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
