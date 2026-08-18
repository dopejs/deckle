import { DROP_WITH_CONTENT } from "./sanitizer.js";

/**
 * Streaming safety boundary for untrusted HTML that is still arriving.
 *
 * An agent emits an artifact token by token, so at any moment the buffer holds
 * a *prefix* of the final document. Rendering that prefix naively is unsafe:
 * `<scr` may become `<script>`, `<div class="` may still gain any attribute,
 * and an unterminated `<style>` hides its content from the tokenizer.
 *
 * `computeSafePrefix` returns the longest prefix whose parse is already
 * decided — no continuation of the stream can change how those bytes are
 * interpreted. Everything after the boundary is withheld until more arrives.
 *
 * The guarantee is *stability*, not acceptance: sanitizing the safe prefix can
 * still reject (a malformed tag is malformed at any length), but the verdict
 * for the bytes inside the boundary never changes as the stream continues.
 */
export type PendingReason =
  | "open-tag"
  | "close-tag"
  | "comment"
  | "declaration"
  | "entity"
  | "surrogate"
  | `rawtext:${string}`;

export interface SafePrefix {
  /** Number of leading characters that are safe to parse now. */
  readonly length: number;
  /** Why the remainder is withheld, or null when the whole buffer is safe. */
  readonly pending: PendingReason | null;
}

/** Longest run scanned back when looking for an unterminated entity. */
const ENTITY_LOOKBACK = 40;

/** Index of the `>` that closes the tag starting at `start`, or -1. */
function findTagEnd(buffer: string, start: number): number {
  let quote: string | null = null;
  for (let index = start + 1; index < buffer.length; index += 1) {
    const char = buffer[index] as string;
    if (quote !== null) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ">") return index;
  }
  return -1;
}

/**
 * Trim a trailing construct that the next chunk could still extend: a partial
 * character reference, or a lone high surrogate that would otherwise be split
 * from its pair.
 */
function trimAmbiguousTail(buffer: string): SafePrefix {
  let end = buffer.length;

  const last = buffer.charCodeAt(end - 1);
  if (end > 0 && last >= 0xd800 && last <= 0xdbff) {
    return { length: end - 1, pending: "surrogate" };
  }

  const from = Math.max(0, end - ENTITY_LOOKBACK);
  const ampersand = buffer.lastIndexOf("&", end - 1);
  if (ampersand >= from && !buffer.slice(ampersand, end).includes(";")) {
    end = ampersand;
    return { length: end, pending: "entity" };
  }

  return { length: buffer.length, pending: null };
}

export function computeSafePrefix(buffer: string): SafePrefix {
  let index = 0;
  let safe = 0;

  while (index < buffer.length) {
    if (buffer[index] !== "<") {
      const next = buffer.indexOf("<", index);
      if (next === -1) {
        const tail = trimAmbiguousTail(buffer);
        return { length: Math.max(safe, tail.length), pending: tail.pending };
      }
      index = next;
      safe = next;
      continue;
    }

    if (buffer.startsWith("<!--", index)) {
      const end = buffer.indexOf("-->", index + 4);
      if (end === -1) return { length: safe, pending: "comment" };
      index = end + 3;
      safe = index;
      continue;
    }

    // "<!" and "<?" may still be completing when only "<" has arrived.
    if (index + 1 >= buffer.length) return { length: safe, pending: "open-tag" };

    if (buffer.startsWith("<!", index) || buffer.startsWith("<?", index)) {
      const end = buffer.indexOf(">", index + 2);
      if (end === -1) return { length: safe, pending: "declaration" };
      index = end + 1;
      safe = index;
      continue;
    }

    const nextChar = buffer[index + 1] as string;

    if (nextChar === "/") {
      const end = findTagEnd(buffer, index);
      if (end === -1) return { length: safe, pending: "close-tag" };
      index = end + 1;
      safe = index;
      continue;
    }

    if (!/[a-zA-Z]/.test(nextChar)) {
      // A "<" that cannot start a tag is literal text and already decided.
      index += 1;
      safe = index;
      continue;
    }

    const end = findTagEnd(buffer, index);
    if (end === -1) return { length: safe, pending: "open-tag" };

    const name = (
      /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(buffer.slice(index, end + 1))?.[1] ?? ""
    ).toLowerCase();
    const selfClosing = buffer[end - 1] === "/";

    if (DROP_WITH_CONTENT.has(name) && !selfClosing) {
      // Raw-text content is skipped wholesale, so the element is only decided
      // once its closing tag has arrived; the boundary stays before "<".
      const close = new RegExp(`</${name}\\s*>`, "i").exec(buffer.slice(end + 1));
      if (!close) return { length: safe, pending: `rawtext:${name}` };
      index = end + 1 + close.index + close[0].length;
      safe = index;
      continue;
    }

    index = end + 1;
    safe = index;
  }

  return { length: safe, pending: null };
}
