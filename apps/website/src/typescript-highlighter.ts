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
