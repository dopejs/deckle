import type { StreamSlice } from "@dopejs/canvas-protocol";

/**
 * Streaming segmentation rules per artifact kind.
 *
 * Every kind an agent produces has a different notion of "stable". Text may
 * grow character by character but must not split a grapheme; markdown must not
 * commit a half-written link or an unterminated fence; JSON is only meaningful
 * at value boundaries; a table row is meaningless until its row ends. Each
 * segmenter answers the same question — how much of this buffer can be
 * rendered now without the meaning changing later — so one streaming engine
 * drives them all.
 */

/** True when the code unit at `index` opens a surrogate pair. */
function isHighSurrogate(buffer: string, index: number): boolean {
  const code = buffer.charCodeAt(index);
  return code >= 0xd800 && code <= 0xdbff;
}

/** Trim a trailing code unit that would split a surrogate pair or ZWJ sequence. */
function graphemeSafeEnd(buffer: string): StreamSlice {
  let end = buffer.length;
  if (end === 0) return { committedLength: 0, pending: null };

  if (isHighSurrogate(buffer, end - 1)) {
    return { committedLength: end - 1, pending: "surrogate" };
  }
  // A trailing zero-width joiner or variation selector promises more to come.
  const last = buffer.charCodeAt(end - 1);
  if (last === 0x200d || (last >= 0xfe00 && last <= 0xfe0f)) {
    end -= 1;
    // Step back over the base character the joiner belongs to.
    if (end > 0 && buffer.charCodeAt(end - 1) >= 0xdc00 && buffer.charCodeAt(end - 1) <= 0xdfff) {
      end -= 2;
    } else if (end > 0) {
      end -= 1;
    }
    return { committedLength: Math.max(0, end), pending: "grapheme" };
  }
  return { committedLength: buffer.length, pending: null };
}

/**
 * Plain text: everything received is stable except a partial grapheme, so the
 * artifact grows character by character the way a reader expects.
 */
export function textSegmenter(buffer: string): StreamSlice {
  return graphemeSafeEnd(buffer);
}

/**
 * Code: complete lines only. A half-written line would be re-highlighted on the
 * next token, and syntax highlighting is line-oriented anyway.
 */
export function codeSegmenter(buffer: string): StreamSlice {
  const lastNewline = buffer.lastIndexOf("\n");
  if (lastNewline === -1) {
    return { committedLength: 0, pending: buffer.length > 0 ? "partial-line" : null };
  }
  if (lastNewline === buffer.length - 1) return { committedLength: buffer.length, pending: null };
  return { committedLength: lastNewline + 1, pending: "partial-line" };
}

const INLINE_MARKERS = ["**", "__", "*", "_", "`", "~~"] as const;

/**
 * Markdown: text may grow inside a paragraph, but the boundary retreats before
 * any construct that is still open — an unterminated fenced block, a link or
 * image whose target has not closed, and a dangling emphasis or code marker.
 * Committing those early would render markup as prose and then reflow.
 */
export function markdownSegmenter(buffer: string): StreamSlice {
  // An odd number of fences means the last block is still open.
  const fences = [...buffer.matchAll(/^ {0,3}(?:```|~~~)/gm)];
  if (fences.length % 2 === 1) {
    const open = fences[fences.length - 1] as RegExpMatchArray;
    return { committedLength: open.index ?? 0, pending: "open-fence" };
  }

  const lastBreak = buffer.lastIndexOf("\n");
  const lineStart = lastBreak + 1;
  const line = buffer.slice(lineStart);

  // A trailing line made only of fence characters may still become a fence.
  // Committing "``" as text and retracting it when the third backtick arrives
  // would move the boundary backwards, which callers are entitled to rely on
  // never happening.
  if (/^ {0,3}(?:`{1,2}|~{1,2})$/.test(line)) {
    return { committedLength: lineStart, pending: "open-fence" };
  }

  // An unbalanced link or image on the trailing line.
  const bracket = Math.max(line.lastIndexOf("!["), line.lastIndexOf("["));
  if (bracket !== -1) {
    const rest = line.slice(bracket);
    if (!/^!?\[[^\]]*\]\([^)]*\)/.test(rest)) {
      const at = lineStart + (line.lastIndexOf("![") === bracket ? bracket : bracket);
      return { committedLength: at, pending: "open-link" };
    }
  }

  for (const marker of INLINE_MARKERS) {
    const occurrences = line.split(marker).length - 1;
    if (occurrences % 2 === 1) {
      return { committedLength: lineStart + line.lastIndexOf(marker), pending: "open-emphasis" };
    }
  }

  return graphemeSafeEnd(buffer);
}

/**
 * Rows (tables, logs, result sets): a row is only meaningful once its line
 * terminator proves it is complete.
 */
export function rowsSegmenter(buffer: string): StreamSlice {
  return codeSegmenter(buffer);
}

interface JsonScan {
  readonly committedLength: number;
  readonly openers: readonly string[];
}

/**
 * Scan JSON tracking string/escape state and structural depth, remembering the
 * last position where a value boundary was reached.
 */
function scanJson(buffer: string): JsonScan {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let committed = 0;
  let stackAtCommit: string[] = [];

  for (let index = 0; index < buffer.length; index += 1) {
    const char = buffer[index] as string;

    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") {
      stack.push(char);
      continue;
    }
    if (char === "}" || char === "]") {
      stack.pop();
      committed = index + 1;
      stackAtCommit = [...stack];
      continue;
    }
    if (char === ",") {
      // A comma ends the preceding element; drop it from the committed prefix
      // so the repaired output stays valid.
      committed = index;
      stackAtCommit = [...stack];
    }
  }

  return { committedLength: committed, openers: stackAtCommit };
}

/**
 * JSON: only value boundaries are stable. A partial number could still gain
 * digits and a partial string could gain characters, so the boundary sits at
 * the last completed element or property.
 */
export function jsonSegmenter(buffer: string): StreamSlice {
  const scan = scanJson(buffer);
  if (scan.committedLength === buffer.length && scan.openers.length === 0) {
    return { committedLength: buffer.length, pending: null };
  }
  return {
    committedLength: scan.committedLength,
    pending: scan.committedLength === buffer.length ? null : "incomplete-value",
  };
}

/**
 * Close the structures a committed JSON prefix left open, so partial output can
 * be parsed and displayed while the rest is still arriving.
 */
export function completeJsonPrefix(prefix: string): string {
  const closers = scanOpeners(prefix)
    .reverse()
    .map((opener) => (opener === "{" ? "}" : "]"));
  return `${prefix}${closers.join("")}`;
}

function scanOpeners(buffer: string): string[] {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let index = 0; index < buffer.length; index += 1) {
    const char = buffer[index] as string;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{" || char === "[") stack.push(char);
    else if (char === "}" || char === "]") stack.pop();
  }
  return stack;
}
