import type { Block, InlineRun, TextStyle } from "./display-list.js";

/**
 * Compile supported content kinds into display-list blocks: the canvas-native
 * profile from design §7.4. Markdown and the sanitized HTML profile become
 * headings, emphasis, lists, and tables; code and JSON become highlighted
 * lines; rows become a real table.
 *
 * This is deliberately a *profile*, not an HTML engine. Anything outside the
 * supported constructs degrades to plain text rather than being approximated.
 */
export interface ContentTheme {
  readonly ink: string;
  readonly muted: string;
  readonly link: string;
  readonly keyword: string;
  readonly string: string;
  readonly number: string;
  readonly punctuation: string;
  readonly comment: string;
  readonly property: string;
  readonly baseSize: number;
}

export const DEFAULT_THEME: ContentTheme = {
  ink: "#20242a",
  muted: "#5a6069",
  link: "#1e66f5",
  keyword: "#9333a8",
  string: "#3f8f34",
  number: "#9a6400",
  punctuation: "#8a8f98",
  comment: "#9aa0a8",
  property: "#1e66f5",
  baseSize: 11,
};

function style(theme: ContentTheme, overrides: Partial<TextStyle> = {}): TextStyle {
  return {
    size: theme.baseSize,
    weight: 400,
    family: "sans",
    italic: false,
    color: theme.ink,
    ...overrides,
  };
}

/* ---------- inline markdown ---------- */

const INLINE_PATTERN = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|`[^`]+`|\[[^\]]*\]\([^)]*\))/;

export function parseInline(text: string, theme: ContentTheme, base = style(theme)): InlineRun[] {
  const runs: InlineRun[] = [];
  let rest = text;

  while (rest.length > 0) {
    const match = INLINE_PATTERN.exec(rest);
    if (!match) {
      runs.push({ text: rest, style: base });
      break;
    }
    if (match.index > 0) runs.push({ text: rest.slice(0, match.index), style: base });

    const token = match[0];
    if (token.startsWith("**") || token.startsWith("__")) {
      runs.push({ text: token.slice(2, -2), style: { ...base, weight: 700 } });
    } else if (token.startsWith("`")) {
      runs.push({
        text: token.slice(1, -1),
        style: { ...base, family: "mono", color: theme.keyword },
      });
    } else if (token.startsWith("[")) {
      const label = /^\[([^\]]*)\]/.exec(token)?.[1] ?? token;
      runs.push({ text: label, style: { ...base, color: theme.link, underline: true } });
    } else {
      runs.push({ text: token.slice(1, -1), style: { ...base, italic: true } });
    }
    rest = rest.slice(match.index + token.length);
  }

  return runs.filter((run) => run.text !== "");
}

/* ---------- code highlighting ---------- */

const KEYWORDS = new Set([
  "const",
  "let",
  "var",
  "function",
  "return",
  "if",
  "else",
  "for",
  "while",
  "throw",
  "new",
  "class",
  "extends",
  "import",
  "export",
  "from",
  "async",
  "await",
  "try",
  "catch",
  "finally",
  "interface",
  "type",
  "number",
  "string",
  "boolean",
  "void",
  "null",
  "true",
  "false",
  "this",
]);

const CODE_TOKEN =
  /(\/\/[^\n]*|"[^"]*"|'[^']*'|`[^`]*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b|\s+|.)/g;

export function highlightCodeLine(line: string, theme: ContentTheme): InlineRun[] {
  const mono = style(theme, { family: "mono" });
  const runs: InlineRun[] = [];
  for (const [token] of line.matchAll(CODE_TOKEN)) {
    if (token.startsWith("//"))
      runs.push({ text: token, style: { ...mono, color: theme.comment, italic: true } });
    else if (/^["'`]/.test(token))
      runs.push({ text: token, style: { ...mono, color: theme.string } });
    else if (/^\d/.test(token)) runs.push({ text: token, style: { ...mono, color: theme.number } });
    else if (KEYWORDS.has(token))
      runs.push({ text: token, style: { ...mono, color: theme.keyword, weight: 600 } });
    else if (/^[\w$]+$/.test(token) || /^\s+$/.test(token)) runs.push({ text: token, style: mono });
    else runs.push({ text: token, style: { ...mono, color: theme.punctuation } });
  }
  return runs;
}

/* ---------- kind compilers ---------- */

export function compileCode(source: string, theme = DEFAULT_THEME): Block[] {
  return source
    .split("\n")
    .map((line) => ({ type: "codeLine" as const, runs: highlightCodeLine(line, theme) }));
}

const JSON_TOKEN =
  /("(?:[^"\\]|\\.)*"\s*:|"(?:[^"\\]|\\.)*"|\b-?\d+(?:\.\d+)?\b|\btrue\b|\bfalse\b|\bnull\b|\s+|.)/g;

/**
 * Format and highlight JSON. Invalid input (a prefix the caller did not repair)
 * falls back to plain monospace rather than guessing at structure.
 */
export function compileJson(source: string, theme = DEFAULT_THEME): Block[] {
  const mono = style(theme, { family: "mono" });
  let formatted = source;
  try {
    formatted = JSON.stringify(JSON.parse(source), null, 2);
  } catch {
    return source.split("\n").map((line) => ({
      type: "codeLine" as const,
      runs: [{ text: line, style: mono }],
    }));
  }

  return formatted.split("\n").map((line) => {
    const runs: InlineRun[] = [];
    for (const [token] of line.matchAll(JSON_TOKEN)) {
      if (token.endsWith(":") || /^"[^"]*"\s*:$/.test(token)) {
        runs.push({ text: token, style: { ...mono, color: theme.property, weight: 600 } });
      } else if (token.startsWith('"')) {
        runs.push({ text: token, style: { ...mono, color: theme.string } });
      } else if (/^-?\d/.test(token)) {
        runs.push({ text: token, style: { ...mono, color: theme.number } });
      } else if (token === "true" || token === "false" || token === "null") {
        runs.push({ text: token, style: { ...mono, color: theme.keyword } });
      } else if (/^\s+$/.test(token)) {
        runs.push({ text: token, style: mono });
      } else {
        runs.push({ text: token, style: { ...mono, color: theme.punctuation } });
      }
    }
    return { type: "codeLine" as const, runs };
  });
}

export function compileRows(source: string, theme = DEFAULT_THEME): Block[] {
  const lines = source.split("\n").filter((line) => line.trim() !== "");
  return lines.map((line, index) => ({
    type: "row" as const,
    header: index === 0,
    cells: line.split(",").map((cell) => [
      {
        text: cell.trim(),
        style: style(theme, {
          weight: index === 0 ? 600 : 400,
          color: index === 0 ? theme.muted : theme.ink,
          family: index === 0 ? "sans" : "mono",
        }),
      },
    ]),
  }));
}

export function compileText(source: string, theme = DEFAULT_THEME): Block[] {
  return source
    .split(/\n{2,}/)
    .filter((paragraph) => paragraph.trim() !== "")
    .map((paragraph) => ({
      type: "paragraph" as const,
      runs: [{ text: paragraph.replace(/\n/g, " "), style: style(theme) }],
    }));
}

export function compileMarkdown(source: string, theme = DEFAULT_THEME): Block[] {
  const blocks: Block[] = [];
  const lines = source.split("\n");
  let paragraph: string[] = [];
  let inFence = false;

  const flush = (): void => {
    if (paragraph.length === 0) return;
    blocks.push({ type: "paragraph", runs: parseInline(paragraph.join(" "), theme) });
    paragraph = [];
  };

  for (const line of lines) {
    if (/^ {0,3}(?:```|~~~)/.test(line)) {
      flush();
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      blocks.push({ type: "codeLine", runs: highlightCodeLine(line, theme) });
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const level = (heading[1] as string).length as 1 | 2 | 3;
      blocks.push({
        type: "heading",
        level,
        runs: parseInline(
          heading[2] as string,
          theme,
          style(theme, { size: theme.baseSize + (4 - level) * 2, weight: 700 }),
        ),
      });
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      flush();
      blocks.push({ type: "listItem", runs: parseInline(bullet[1] as string, theme) });
      continue;
    }

    if (line.trim() === "") {
      flush();
      continue;
    }
    paragraph.push(line.trim());
  }
  flush();
  return blocks;
}

/**
 * Compile the sanitized HTML profile. The sanitizer already guarantees a
 * well-formed, allowlisted subset, so this walks tags directly; anything
 * outside the supported set contributes its text only.
 */
export function compileHtmlProfile(html: string, theme = DEFAULT_THEME): Block[] {
  const blocks: Block[] = [];
  const tokens = html.match(/<\/?[a-z0-9]+[^>]*>|[^<]+/gi) ?? [];

  let runs: InlineRun[] = [];
  let cells: InlineRun[][] = [];
  let inRow = false;
  let headerRow = false;
  let current: Block["type"] | "row" = "paragraph";
  let level: 1 | 2 | 3 = 3;
  const styleStack: TextStyle[] = [style(theme)];

  const top = (): TextStyle => styleStack[styleStack.length - 1] as TextStyle;
  const flush = (): void => {
    if (runs.length === 0) return;
    if (current === "heading") blocks.push({ type: "heading", level, runs });
    else if (current === "listItem") blocks.push({ type: "listItem", runs });
    else blocks.push({ type: "paragraph", runs });
    runs = [];
    current = "paragraph";
  };

  for (const token of tokens) {
    if (!token.startsWith("<")) {
      const text = token.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
      if (text.trim() !== "") runs.push({ text: text.replace(/\s+/g, " "), style: top() });
      continue;
    }

    const closing = token.startsWith("</");
    const name = (/^<\/?([a-z0-9]+)/i.exec(token)?.[1] ?? "").toLowerCase();

    switch (name) {
      case "h1":
      case "h2":
      case "h3":
        if (closing) flush();
        else {
          flush();
          current = "heading";
          level = Number(name[1]) as 1 | 2 | 3;
          styleStack.push(style(theme, { size: theme.baseSize + (4 - level) * 2, weight: 700 }));
        }
        if (closing) styleStack.pop();
        break;
      case "p":
      case "div":
      case "section":
      case "article":
        if (closing) flush();
        break;
      case "li":
        if (closing) flush();
        else {
          flush();
          current = "listItem";
        }
        break;
      case "strong":
      case "b":
        if (closing) styleStack.pop();
        else styleStack.push({ ...top(), weight: 700 });
        break;
      case "em":
      case "i":
        if (closing) styleStack.pop();
        else styleStack.push({ ...top(), italic: true });
        break;
      case "code":
        if (closing) styleStack.pop();
        else styleStack.push({ ...top(), family: "mono", color: theme.keyword });
        break;
      case "a":
        if (closing) styleStack.pop();
        else styleStack.push({ ...top(), color: theme.link, underline: true });
        break;
      case "tr":
        if (closing) {
          if (cells.length > 0) blocks.push({ type: "row", cells, header: headerRow });
          cells = [];
          inRow = false;
          headerRow = false;
        } else {
          flush();
          inRow = true;
          cells = [];
        }
        break;
      case "th":
      case "td":
        if (closing) {
          if (inRow) cells.push(runs);
          runs = [];
        } else if (name === "th") {
          headerRow = true;
        }
        break;
      default:
        break;
    }
  }
  flush();
  return blocks;
}
