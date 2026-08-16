/**
 * URL scheme policy for untrusted artifact content. The default posture is an
 * allowlist: anything that does not affirmatively match a granted scheme is
 * denied, including scheme-smuggling via control characters or whitespace.
 */
export interface UrlPolicy {
  /** Lowercase schemes without the trailing colon, e.g. "https". */
  readonly allowedSchemes: readonly string[];
  /** Allow same-document fragment references ("#section"). */
  readonly allowFragments: boolean;
  /** Allow `data:image/(png|gif|jpeg|webp)` payloads. */
  readonly allowDataImages: boolean;
}

export const DEFAULT_URL_POLICY: UrlPolicy = {
  allowedSchemes: ["https"],
  allowFragments: true,
  allowDataImages: false,
};

export type UrlDecision =
  | { readonly allowed: true; readonly normalized: string }
  | { readonly allowed: false; readonly reason: string };

// C0 controls, space, DEL, C1 controls, plus zero-width/BOM characters that
// browsers strip before scheme parsing ("jav\tascript:" executes).
/* eslint-disable no-control-regex -- deliberately matching raw control characters */
const CONTROL_OR_WHITESPACE =
  /[\u0000-\u0020\u007f-\u00a0\u00ad\u200b-\u200f\u2028\u2029\u2060\ufeff]/;
/* eslint-enable no-control-regex */
const DATA_IMAGE_PATTERN = /^data:image\/(?:png|gif|jpeg|webp);base64,[a-z0-9+/=]+$/i;

export function evaluateUrl(rawUrl: string, policy: UrlPolicy = DEFAULT_URL_POLICY): UrlDecision {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) {
    return { allowed: false, reason: "empty-url" };
  }
  if (rawUrl.length > 8192) {
    return { allowed: false, reason: "url-too-long" };
  }
  if (CONTROL_OR_WHITESPACE.test(rawUrl)) {
    return { allowed: false, reason: "control-characters" };
  }

  if (rawUrl.startsWith("#")) {
    return policy.allowFragments
      ? { allowed: true, normalized: rawUrl }
      : { allowed: false, reason: "fragment-denied" };
  }

  if (/^data:/i.test(rawUrl)) {
    if (policy.allowDataImages && DATA_IMAGE_PATTERN.test(rawUrl)) {
      return { allowed: true, normalized: rawUrl };
    }
    return { allowed: false, reason: "data-url-denied" };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    // Relative URLs would resolve against the host document origin; artifacts
    // have no granted origin, so relative references are denied.
    return { allowed: false, reason: "relative-or-unparseable" };
  }
  const scheme = parsed.protocol.replace(/:$/, "").toLowerCase();
  if (!policy.allowedSchemes.includes(scheme)) {
    return { allowed: false, reason: `scheme-denied:${scheme}` };
  }
  return { allowed: true, normalized: parsed.toString() };
}
