import type { ArtifactKind, MediaMetadata } from "@dopejs/canvas-protocol";
import { DEFAULT_THEME, type ContentTheme } from "./content.js";
import type { Block, InlineRun, TextStyle } from "./display-list.js";

/**
 * Presentations for the states an artifact spends real time in besides "has
 * content": waiting for its first bytes, and having failed.
 *
 * Every kind needs both. A streamed artifact is empty until its segmenter
 * commits a first character, and media has no partial form at all — an empty
 * frame in either case reads as a broken artifact rather than a pending one.
 */
export interface StatusTheme extends ContentTheme {
  readonly skeleton: string;
  readonly mediaTone: string;
  readonly danger: string;
}

export const DEFAULT_STATUS_THEME: StatusTheme = {
  ...DEFAULT_THEME,
  skeleton: "#e6e5df",
  mediaTone: "#eceaf3",
  danger: "#b3261e",
};

function style(theme: StatusTheme, overrides: Partial<TextStyle> = {}): TextStyle {
  return {
    size: theme.baseSize,
    weight: 400,
    family: "sans",
    italic: false,
    color: theme.ink,
    ...overrides,
  };
}

/** Aspect ratio to reserve before the real dimensions are known. */
const PLACEHOLDER_ASPECT: Record<"image" | "video", number> = { image: 4 / 3, video: 16 / 9 };

export interface LoadingOptions {
  readonly kind: ArtifactKind;
  /** 0-1 for a determinate bar; null or omitted stays indeterminate. */
  readonly progress?: number | null;
  /** What the host is waiting on, shown beneath the placeholder. */
  readonly label?: string;
}

/**
 * A frame with content on the way. Text-like kinds get skeleton bars sized like
 * the prose they will hold; media reserves its box so the layout does not jump
 * when the real dimensions arrive.
 */
export function compileLoading(
  options: LoadingOptions,
  theme: StatusTheme = DEFAULT_STATUS_THEME,
): Block[] {
  const caption: InlineRun[] = [
    {
      text: options.label ?? `loading ${options.kind}…`,
      style: style(theme, { color: theme.muted, size: theme.baseSize - 0.5 }),
    },
  ];

  if (options.kind === "image" || options.kind === "video") {
    return [
      {
        type: "media",
        aspect: PLACEHOLDER_ASPECT[options.kind],
        caption,
        progress: options.progress ?? null,
        tone: theme.mediaTone,
      },
    ];
  }

  return [
    { type: "skeleton", lines: 4 },
    { type: "paragraph", runs: caption },
  ];
}

/**
 * Ready media. The box carries the real aspect ratio so the frame matches what
 * the host will draw into it, with a caption naming the intrinsic size.
 */
export function compileMedia(
  kind: "image" | "video",
  metadata: MediaMetadata,
  theme: StatusTheme = DEFAULT_STATUS_THEME,
): Block[] {
  const aspect =
    metadata.width > 0 && metadata.height > 0
      ? metadata.width / metadata.height
      : PLACEHOLDER_ASPECT[kind];
  const duration =
    kind === "video" && metadata.durationMs !== undefined
      ? ` · ${(metadata.durationMs / 1000).toFixed(1)}s`
      : "";
  return [
    {
      type: "media",
      aspect,
      progress: null,
      tone: theme.mediaTone,
      caption: [
        {
          text: `${kind} ${metadata.width}×${metadata.height}${duration}`,
          style: style(theme, { family: "mono", color: theme.muted, size: theme.baseSize - 0.5 }),
        },
      ],
    },
  ];
}

export interface ArtifactError {
  readonly code: string;
  readonly message: string;
  /** Whether retrying could succeed; shown so a reader knows what to do next. */
  readonly recoverable?: boolean;
}

/**
 * A failed artifact. The reason and its typed code are both shown: the message
 * tells a reader what happened, the code is what they quote in a bug report.
 */
export function compileError(
  failure: ArtifactError,
  theme: StatusTheme = DEFAULT_STATUS_THEME,
): Block[] {
  return [
    {
      type: "paragraph",
      runs: [
        {
          text: failure.recoverable === false ? "Failed" : "Failed — can retry",
          style: style(theme, { color: theme.danger, weight: 600 }),
        },
      ],
    },
    {
      type: "paragraph",
      runs: [{ text: failure.message, style: style(theme, { color: theme.ink }) }],
    },
    {
      type: "codeLine",
      runs: [
        {
          text: failure.code,
          style: style(theme, { family: "mono", color: theme.muted, size: theme.baseSize - 0.5 }),
        },
      ],
    },
  ];
}
