import {
  checkQuota,
  DEFAULT_QUOTAS,
  utf8ByteLength,
  type QuotaLimits,
  type QuotaViolation,
} from "./quotas.js";
import { DEFAULT_URL_POLICY, evaluateUrl, type UrlPolicy } from "./url-policy.js";

/**
 * Static-profile HTML sanitizer. The output is re-serialized entirely from
 * allowlisted parts — raw input never passes through. Anything the tokenizer
 * cannot positively parse causes a hard rejection (fail closed) rather than a
 * best-effort guess.
 */
export interface SanitizeOptions {
  readonly quotas?: QuotaLimits;
  readonly urlPolicy?: UrlPolicy;
}

export interface SanitizeDiagnostic {
  readonly code:
    | "dropped-element"
    | "unwrapped-element"
    | "dropped-attribute"
    | "dropped-comment"
    | "dropped-declaration"
    | "denied-url"
    | "invalid-style";
  readonly detail: string;
}

export type SanitizeResult =
  | {
      readonly ok: true;
      readonly html: string;
      readonly elementCount: number;
      readonly diagnostics: readonly SanitizeDiagnostic[];
    }
  | {
      readonly ok: false;
      readonly reason: "unparseable" | "quota-exceeded";
      readonly detail: string;
      readonly violation?: QuotaViolation;
    };

/**
 * Elements whose entire subtree is executable, styling, or embedding risk.
 * Their content is skipped as raw text up to the matching close tag, matching
 * browser rawtext parsing for script/style and failing closed for the rest.
 */
const DROP_WITH_CONTENT = new Set([
  "script",
  "style",
  "iframe",
  "frameset",
  "object",
  "applet",
  "template",
  "noscript",
  "svg",
  "math",
  "title",
  "textarea",
  "form",
  "dialog",
  "slot",
]);

/** Dangerous void elements: dropped in place, no close tag expected. */
const DROP_VOID = new Set(["embed", "link", "meta", "base", "frame", "source", "track", "param"]);

const ALLOWED_TAGS = new Set([
  "a",
  "abbr",
  "address",
  "article",
  "aside",
  "b",
  "blockquote",
  "br",
  "button",
  "caption",
  "cite",
  "code",
  "col",
  "colgroup",
  "dd",
  "del",
  "details",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "i",
  "img",
  "input",
  "ins",
  "kbd",
  "label",
  "legend",
  "li",
  "main",
  "mark",
  "nav",
  "ol",
  "option",
  "p",
  "pre",
  "q",
  "s",
  "samp",
  "section",
  "select",
  "small",
  "span",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "time",
  "tr",
  "u",
  "ul",
  "wbr",
]);

const VOID_TAGS = new Set(["br", "col", "hr", "img", "input", "wbr"]);

const GLOBAL_ATTRIBUTES = new Set([
  "id",
  "class",
  "title",
  "role",
  "dir",
  "lang",
  "hidden",
  "tabindex",
  "style",
  "alt",
  "colspan",
  "rowspan",
  "type",
  "value",
  "placeholder",
  "name",
  "disabled",
  "checked",
  "selected",
  "readonly",
  "min",
  "max",
  "step",
  "start",
  "open",
  "width",
  "height",
  "datetime",
  "for",
]);

const URL_ATTRIBUTES = new Set(["href", "src"]);

const INPUT_TYPE_ALLOWLIST = new Set([
  "text",
  "checkbox",
  "radio",
  "number",
  "range",
  "date",
  "time",
  "email",
  "search",
]);

const TAG_OPEN = /^<([a-zA-Z][a-zA-Z0-9-]*)/;
const TAG_CLOSE = /^<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>/;
const ATTRIBUTE = /^\s+([a-zA-Z_:][a-zA-Z0-9_:.-]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|[^\s"'`<>=]+))?/;
const SAFE_TEXT_ENTITY = /&(?!#\d{1,7};|#x[0-9a-fA-F]{1,6};|[a-zA-Z][a-zA-Z0-9]{1,31};)/g;
const HOSTILE_STYLE = /url\s*\(|expression\s*\(|@import|javascript:|behavior\s*:|-moz-binding|\\/i;

function escapeText(text: string): string {
  return text.replace(SAFE_TEXT_ENTITY, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
  return value
    .replace(SAFE_TEXT_ENTITY, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface ParsedAttribute {
  readonly name: string;
  readonly value: string | null;
}

export function sanitizeHtml(source: string, options: SanitizeOptions = {}): SanitizeResult {
  const quotas = options.quotas ?? DEFAULT_QUOTAS;
  const urlPolicy = options.urlPolicy ?? DEFAULT_URL_POLICY;

  const sourceBytes = utf8ByteLength(source);
  const byteViolation = checkQuota(quotas, "maxSourceBytes", sourceBytes);
  if (byteViolation) {
    return {
      ok: false,
      reason: "quota-exceeded",
      detail: `source is ${sourceBytes} bytes`,
      violation: byteViolation,
    };
  }

  const diagnostics: SanitizeDiagnostic[] = [];
  const output: string[] = [];
  /** Open allowlisted elements awaiting their close tag. */
  const openStack: string[] = [];
  let elementCount = 0;
  let position = 0;

  const quotaFail = (quota: keyof QuotaLimits, actual: number): SanitizeResult => {
    const violation = checkQuota(quotas, quota, actual) ?? { quota, actual, limit: quotas[quota] };
    return { ok: false, reason: "quota-exceeded", detail: `${quota} exceeded`, violation };
  };

  while (position < source.length) {
    const nextTag = source.indexOf("<", position);
    if (nextTag === -1) {
      output.push(escapeText(source.slice(position)));
      break;
    }
    if (nextTag > position) {
      output.push(escapeText(source.slice(position, nextTag)));
      position = nextTag;
    }

    const rest = source.slice(position);

    if (rest.startsWith("<!--")) {
      const end = source.indexOf("-->", position + 4);
      if (end === -1) {
        return { ok: false, reason: "unparseable", detail: "unterminated comment" };
      }
      diagnostics.push({ code: "dropped-comment", detail: "comment removed" });
      position = end + 3;
      continue;
    }

    if (rest.startsWith("<!") || rest.startsWith("<?")) {
      const end = source.indexOf(">", position + 2);
      if (end === -1) {
        return { ok: false, reason: "unparseable", detail: "unterminated declaration" };
      }
      diagnostics.push({
        code: "dropped-declaration",
        detail: source.slice(position, end + 1).slice(0, 64),
      });
      position = end + 1;
      continue;
    }

    const closeMatch = TAG_CLOSE.exec(rest);
    if (closeMatch) {
      const tag = (closeMatch[1] as string).toLowerCase();
      position += closeMatch[0].length;
      const openIndex = openStack.lastIndexOf(tag);
      if (openIndex === -1) continue; // stray close tag: ignore
      while (openStack.length > openIndex) {
        const closing = openStack.pop() as string;
        output.push(`</${closing}>`);
      }
      continue;
    }

    const openMatch = TAG_OPEN.exec(rest);
    if (!openMatch) {
      // A bare "<" that opens no recognizable construct: escape it as text.
      output.push("&lt;");
      position += 1;
      continue;
    }

    const tag = (openMatch[1] as string).toLowerCase();
    let cursor = position + openMatch[0].length;

    const attributes: ParsedAttribute[] = [];
    for (;;) {
      const attrMatch = ATTRIBUTE.exec(source.slice(cursor));
      if (!attrMatch) break;
      const value = attrMatch[3] ?? attrMatch[4] ?? attrMatch[2] ?? null;
      attributes.push({ name: (attrMatch[1] as string).toLowerCase(), value });
      cursor += attrMatch[0].length;
    }

    const tail = /^\s*(\/?)>/.exec(source.slice(cursor));
    if (!tail) {
      return {
        ok: false,
        reason: "unparseable",
        detail: `malformed tag <${tag} at offset ${position}`,
      };
    }
    const selfClosing = tail[1] === "/" || VOID_TAGS.has(tag);
    position = cursor + tail[0].length;

    if (DROP_VOID.has(tag)) {
      diagnostics.push({ code: "dropped-element", detail: tag });
      continue;
    }

    if (DROP_WITH_CONTENT.has(tag)) {
      diagnostics.push({ code: "dropped-element", detail: tag });
      if (!selfClosing) {
        // Raw-skip to the matching close tag, mirroring browser rawtext
        // parsing for script/style and failing closed when it is missing.
        const closePattern = new RegExp(`</${tag}\\s*>`, "i");
        const match = closePattern.exec(source.slice(position));
        if (!match) {
          return { ok: false, reason: "unparseable", detail: `unterminated <${tag}>` };
        }
        position += match.index + match[0].length;
      }
      continue;
    }

    if (!ALLOWED_TAGS.has(tag)) {
      diagnostics.push({ code: "unwrapped-element", detail: tag });
      continue; // children remain; the tag itself is not emitted
    }

    elementCount += 1;
    if (checkQuota(quotas, "maxDomNodes", elementCount)) {
      return quotaFail("maxDomNodes", elementCount);
    }
    if (!selfClosing && checkQuota(quotas, "maxNestingDepth", openStack.length + 1)) {
      return quotaFail("maxNestingDepth", openStack.length + 1);
    }
    if (attributes.length > quotas.maxAttributesPerNode) {
      return quotaFail("maxAttributesPerNode", attributes.length);
    }

    const keptAttributes: string[] = [];
    for (const attribute of attributes) {
      const kept = sanitizeAttribute(tag, attribute, quotas, urlPolicy, diagnostics);
      if (kept === null) continue;
      keptAttributes.push(kept);
    }

    output.push(`<${tag}${keptAttributes.length > 0 ? ` ${keptAttributes.join(" ")}` : ""}>`);
    if (!selfClosing) {
      openStack.push(tag);
    }
  }

  while (openStack.length > 0) {
    output.push(`</${openStack.pop() as string}>`);
  }

  return { ok: true, html: output.join(""), elementCount, diagnostics };
}

function sanitizeAttribute(
  tag: string,
  attribute: ParsedAttribute,
  quotas: QuotaLimits,
  urlPolicy: UrlPolicy,
  diagnostics: SanitizeDiagnostic[],
): string | null {
  const { name } = attribute;
  const value = attribute.value ?? "";

  if (
    name.startsWith("on") ||
    name === "srcdoc" ||
    name === "formaction" ||
    name.startsWith("xlink")
  ) {
    diagnostics.push({ code: "dropped-attribute", detail: `${tag}@${name}` });
    return null;
  }
  const isData = name.startsWith("data-");
  const isAria = name.startsWith("aria-");
  const isUrl = URL_ATTRIBUTES.has(name) && (tag === "a" || tag === "img");
  if (!isData && !isAria && !isUrl && !GLOBAL_ATTRIBUTES.has(name)) {
    diagnostics.push({ code: "dropped-attribute", detail: `${tag}@${name}` });
    return null;
  }
  if (value.length > quotas.maxAttributeValueLength) {
    diagnostics.push({ code: "dropped-attribute", detail: `${tag}@${name}:too-long` });
    return null;
  }

  if (isUrl) {
    const decision = evaluateUrl(value, urlPolicy);
    if (!decision.allowed) {
      diagnostics.push({ code: "denied-url", detail: `${tag}@${name}:${decision.reason}` });
      return null;
    }
    return `${name}="${escapeAttribute(decision.normalized)}"`;
  }

  if (name === "style") {
    if (HOSTILE_STYLE.test(value)) {
      diagnostics.push({ code: "invalid-style", detail: value.slice(0, 64) });
      return null;
    }
  }

  if (name === "type" && tag === "input" && !INPUT_TYPE_ALLOWLIST.has(value.toLowerCase())) {
    diagnostics.push({ code: "dropped-attribute", detail: `input@type:${value.slice(0, 32)}` });
    return null;
  }
  if (name === "type" && tag === "button" && value.toLowerCase() !== "button") {
    // Only non-submitting buttons exist in the static profile.
    return 'type="button"';
  }

  if (attribute.value === null) return name;
  return `${name}="${escapeAttribute(value)}"`;
}
