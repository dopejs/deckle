/**
 * Backend-neutral display list for the canvas-native content profile
 * (design §7.4). Supported content compiles to positioned text runs and rules
 * rather than a DOM subtree, so an artifact can be *rendered* — headings,
 * emphasis, highlighted code, real tables — while it is still a retained
 * picture rather than live markup.
 *
 * Layout is pure: text measurement is injected, so the same content produces
 * the same geometry in a browser, in a worker, and in a test.
 */
export interface TextStyle {
  readonly size: number;
  readonly weight: 400 | 600 | 700;
  readonly family: "sans" | "mono";
  readonly italic: boolean;
  readonly color: string;
  /** Draw a baseline underline, used for links. */
  readonly underline?: boolean;
}

export interface InlineRun {
  readonly text: string;
  readonly style: TextStyle;
}

export type Block =
  | { readonly type: "heading"; readonly level: 1 | 2 | 3; readonly runs: readonly InlineRun[] }
  | { readonly type: "paragraph"; readonly runs: readonly InlineRun[] }
  | { readonly type: "listItem"; readonly runs: readonly InlineRun[] }
  /** A pre-formatted line: never wrapped, clipped instead. */
  | { readonly type: "codeLine"; readonly runs: readonly InlineRun[] }
  | {
      readonly type: "row";
      readonly cells: readonly (readonly InlineRun[])[];
      readonly header: boolean;
    }
  | { readonly type: "spacer" }
  /** Placeholder bars for content that has not arrived yet. */
  | { readonly type: "skeleton"; readonly lines: number }
  /** A media box that reserves its aspect ratio before the media decodes. */
  | {
      readonly type: "media";
      readonly aspect: number;
      readonly caption: readonly InlineRun[];
      /** 0-1 for a determinate bar, null for indeterminate. */
      readonly progress: number | null;
      readonly tone: string;
    };

export interface PositionedRun {
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly style: TextStyle;
  /** Maximum width the backend should clip this run to. */
  readonly maxWidth: number;
}

/** A filled box: skeleton bar, media placeholder, progress track, error accent. */
export interface DisplayRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fill: string;
  readonly radius?: number;
}

export interface DisplayRule {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly color: string;
}

export interface DisplayList {
  readonly runs: readonly PositionedRun[];
  readonly rules: readonly DisplayRule[];
  readonly rects: readonly DisplayRect[];
  /** Total laid-out height, so callers can scroll or clip. */
  readonly height: number;
}

export type MeasureText = (text: string, style: TextStyle) => number;

export interface LayoutOptions {
  readonly width: number;
  readonly measure: MeasureText;
  /** Multiplier applied to a run's size to get its line height. */
  readonly lineHeight?: number;
  readonly blockGap?: number;
  readonly ruleColor?: string;
  readonly skeletonColor?: string;
  readonly progressColor?: string;
  /** Caps a media placeholder so a tall aspect ratio cannot dominate a frame. */
  readonly maxMediaHeight?: number;
}

const DEFAULT_LINE_HEIGHT = 1.45;
const DEFAULT_BLOCK_GAP = 6;
const BULLET = "• ";
const LIST_INDENT = 14;

function lineHeightOf(runs: readonly InlineRun[], multiplier: number): number {
  const size = runs.reduce((max, run) => Math.max(max, run.style.size), 0);
  return Math.max(size, 1) * multiplier;
}

/** Split a run into words while keeping the spaces that separate them. */
function words(text: string): string[] {
  return text.split(/(\s+)/).filter((piece) => piece !== "");
}

interface WrapState {
  readonly runs: PositionedRun[];
  y: number;
}

function wrapRuns(
  runs: readonly InlineRun[],
  options: LayoutOptions,
  state: WrapState,
  indent: number,
  prefix?: InlineRun,
): void {
  const lineHeight = lineHeightOf(
    runs.length > 0 ? runs : prefix ? [prefix] : [],
    options.lineHeight ?? DEFAULT_LINE_HEIGHT,
  );

  // Flatten to placeable pieces first so all wrapping state stays in one scope.
  const pieces: InlineRun[] = prefix ? [prefix] : [];
  for (const run of runs) {
    for (const piece of words(run.text)) pieces.push({ text: piece, style: run.style });
  }

  let cursorX = indent;
  let lineUsed = false;
  for (const piece of pieces) {
    const isSpace = /^\s+$/.test(piece.text);
    const width = options.measure(piece.text, piece.style);
    if (!isSpace && lineUsed && cursorX + width > options.width) {
      state.y += lineHeight;
      cursorX = indent;
      lineUsed = false;
    }
    if (isSpace && !lineUsed) continue; // never start a line with a space
    state.runs.push({
      x: cursorX,
      y: state.y + lineHeight,
      text: piece.text,
      style: piece.style,
      maxWidth: Math.max(0, options.width - cursorX),
    });
    cursorX += width;
    lineUsed = true;
  }

  state.y += lineHeight;
}

function columnWidths(
  rows: readonly Extract<Block, { type: "row" }>[],
  options: LayoutOptions,
): number[] {
  const count = rows.reduce((max, row) => Math.max(max, row.cells.length), 0);
  const natural = Array.from({ length: count }, (_, column) =>
    rows.reduce((max, row) => {
      const cell = row.cells[column] ?? [];
      const width = cell.reduce((sum, run) => sum + options.measure(run.text, run.style), 0);
      return Math.max(max, width);
    }, 0),
  );
  const gap = 10;
  const total = natural.reduce((sum, width) => sum + width, 0) + gap * Math.max(0, count - 1);
  if (total <= options.width || total === 0) return natural;
  // Scale proportionally when the natural widths overflow the frame.
  const scale =
    (options.width - gap * Math.max(0, count - 1)) / (total - gap * Math.max(0, count - 1));
  return natural.map((width) => width * scale);
}

export function layoutBlocks(blocks: readonly Block[], options: LayoutOptions): DisplayList {
  const state: WrapState = { runs: [], y: 0 };
  const rules: DisplayRule[] = [];
  const rects: DisplayRect[] = [];
  const blockGap = options.blockGap ?? DEFAULT_BLOCK_GAP;
  const ruleColor = options.ruleColor ?? "#d9d8d0";
  const lineHeightMultiplier = options.lineHeight ?? DEFAULT_LINE_HEIGHT;

  // Tables lay out as a group so columns line up across consecutive rows.
  let index = 0;
  while (index < blocks.length) {
    const block = blocks[index] as Block;

    if (block.type === "row") {
      const group: Extract<Block, { type: "row" }>[] = [];
      while (index < blocks.length && (blocks[index] as Block).type === "row") {
        group.push(blocks[index] as Extract<Block, { type: "row" }>);
        index += 1;
      }
      const widths = columnWidths(group, options);
      for (const row of group) {
        const height = lineHeightOf(row.cells.flat(), lineHeightMultiplier);
        let x = 0;
        row.cells.forEach((cell, column) => {
          let cellX = x;
          for (const run of cell) {
            state.runs.push({
              x: cellX,
              y: state.y + height,
              text: run.text,
              style: run.style,
              maxWidth: widths[column] ?? 0,
            });
            cellX += options.measure(run.text, run.style);
          }
          x += (widths[column] ?? 0) + 10;
        });
        state.y += height;
        if (row.header) {
          rules.push({ x: 0, y: state.y + 1, width: options.width, color: ruleColor });
          state.y += 3;
        }
      }
      state.y += blockGap;
      continue;
    }

    index += 1;

    switch (block.type) {
      case "spacer":
        state.y += blockGap;
        break;
      case "skeleton": {
        // Bars of uneven width read as text that has not arrived; a uniform
        // block reads as a rendering bug.
        const barHeight = 9;
        const widths = [1, 0.92, 0.74, 0.85, 0.6];
        for (let line = 0; line < block.lines; line += 1) {
          rects.push({
            x: 0,
            y: state.y,
            width: options.width * (widths[line % widths.length] as number),
            height: barHeight,
            fill: options.skeletonColor ?? "#e6e5df",
            radius: 3,
          });
          state.y += barHeight + 7;
        }
        state.y += blockGap;
        break;
      }
      case "media": {
        const height = Math.min(options.width / block.aspect, options.maxMediaHeight ?? 240);
        const width = Math.min(options.width, height * block.aspect);
        rects.push({ x: 0, y: state.y, width, height, fill: block.tone, radius: 6 });
        if (block.progress !== null) {
          const track = 4;
          rects.push({
            x: 0,
            y: state.y + height - track,
            width: width * Math.max(0, Math.min(1, block.progress)),
            height: track,
            fill: options.progressColor ?? "#1e66f5",
            radius: 2,
          });
        }
        state.y += height + 4;
        if (block.caption.length > 0) wrapRuns(block.caption, options, state, 0);
        state.y += blockGap;
        break;
      }
      case "heading":
        wrapRuns(block.runs, options, state, 0);
        state.y += 2;
        break;
      case "listItem": {
        const marker = block.runs[0]?.style ?? {
          size: 12,
          weight: 400 as const,
          family: "sans" as const,
          italic: false,
          color: "#5a6069",
        };
        wrapRuns(block.runs, options, state, LIST_INDENT, { text: BULLET, style: marker });
        break;
      }
      case "codeLine": {
        const height = lineHeightOf(block.runs, lineHeightMultiplier);
        let x = 0;
        for (const run of block.runs) {
          state.runs.push({
            x,
            y: state.y + height,
            text: run.text,
            style: run.style,
            maxWidth: Math.max(0, options.width - x),
          });
          x += options.measure(run.text, run.style);
        }
        state.y += height;
        break;
      }
      case "paragraph":
        wrapRuns(block.runs, options, state, 0);
        state.y += blockGap;
        break;
    }
  }

  return { runs: state.runs, rules, rects, height: state.y };
}
