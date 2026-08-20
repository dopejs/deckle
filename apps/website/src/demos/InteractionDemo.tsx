import {
  createInteractionTree,
  matrixMultiply,
  matrixRotate,
  matrixTranslate,
  type InteractionNode,
  type InteractionTree,
  type Mat2D,
} from "@dopejs/deckle-artifact";
import {
  CachedHitTester,
  escapeToParent,
  NaiveHitTester,
  NO_SELECTION,
  resolveClick,
  type EditorSelection,
} from "@dopejs/deckle-editor";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

const WIDTH = 720;
const HEIGHT = 460;
const OFFSET_X = 30;
const OFFSET_Y = 30;
const IDENTITY: Mat2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

interface FlatNode {
  readonly node: InteractionNode;
  readonly world: Mat2D;
}

function fixtureTree(): InteractionTree {
  return createInteractionTree("demo", 1, 1, [
    { id: "root", bounds: { x: 0, y: 0, width: 640, height: 400 } },
    {
      id: "panel",
      parentId: "root",
      paintOrder: 1,
      transform: matrixTranslate(40, 40),
      bounds: { x: 0, y: 0, width: 320, height: 240 },
      clip: { rect: { x: 0, y: 0, width: 320, height: 240 } },
    },
    {
      id: "button",
      parentId: "panel",
      transform: matrixTranslate(24, 32),
      bounds: { x: 0, y: 0, width: 140, height: 44 },
      role: "button",
    },
    {
      id: "overflow-card",
      parentId: "panel",
      transform: matrixTranslate(220, 160),
      bounds: { x: 0, y: 0, width: 220, height: 140 },
    },
    {
      id: "rotated-badge",
      parentId: "root",
      paintOrder: 2,
      transform: { ...matrixRotate(Math.PI / 8), e: 420, f: 80 },
      bounds: { x: 0, y: 0, width: 160, height: 90 },
    },
  ]);
}

function flatten(tree: InteractionTree): FlatNode[] {
  const result: FlatNode[] = [];
  const visit = (parentId: string | null, parentWorld: Mat2D): void => {
    for (const node of tree.nodes.filter((candidate) => candidate.parentId === parentId)) {
      const world = matrixMultiply(parentWorld, node.transform);
      result.push({ node, world });
      visit(node.id, world);
    }
  };
  visit(null, IDENTITY);
  return result;
}

function selectionText(selection: EditorSelection): string {
  if (selection.kind === "node") return selection.nodeId;
  if (selection.kind === "artifact") return "artifact frame";
  return "none";
}

export function InteractionDemo(): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tree = useMemo(fixtureTree, []);
  const flat = useMemo(() => flatten(tree), [tree]);
  const cached = useMemo(() => new CachedHitTester(tree), [tree]);
  const naive = useMemo(() => new NaiveHitTester(tree), [tree]);
  const [selection, setSelection] = useState<EditorSelection>(NO_SELECTION);
  const [probe, setProbe] = useState("click a nested node to begin");
  const [themeRevision, setThemeRevision] = useState(0);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setThemeRevision((value) => value + 1);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas === null || context === null || context === undefined) return;
    const dpr = Math.max(1, Math.min(3, globalThis.devicePixelRatio || 1));
    canvas.width = Math.round(WIDTH * dpr);
    canvas.height = Math.round(HEIGHT * dpr);
    const dark = document.documentElement.dataset.theme === "dark";
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.fillStyle = dark ? "#0d131e" : "#f7f8fa";
    context.fillRect(0, 0, WIDTH, HEIGHT);
    context.save();
    context.translate(OFFSET_X, OFFSET_Y);

    for (const { node, world } of flat) {
      const selected = selection.kind === "node" && selection.nodeId === node.id;
      context.save();
      context.transform(world.a, world.b, world.c, world.d, world.e, world.f);
      if (node.clip !== null) {
        context.strokeStyle = dark ? "#69778d" : "#8b94a3";
        context.setLineDash([5, 4]);
        context.strokeRect(
          node.clip.rect.x,
          node.clip.rect.y,
          node.clip.rect.width,
          node.clip.rect.height,
        );
        context.setLineDash([]);
      }
      context.fillStyle = selected ? (dark ? "#243c6b" : "#dce8ff") : dark ? "#182131" : "#edf1f7";
      context.strokeStyle = selected ? "#6f9cff" : dark ? "#445269" : "#a9b3c2";
      context.lineWidth = selected ? 3 : 1;
      context.fillRect(node.bounds.x, node.bounds.y, node.bounds.width, node.bounds.height);
      context.strokeRect(node.bounds.x, node.bounds.y, node.bounds.width, node.bounds.height);
      context.fillStyle = dark ? "#e8edf6" : "#263142";
      context.font = "12px system-ui";
      context.fillText(node.id, node.bounds.x + 7, node.bounds.y + 17);
      context.restore();
    }
    context.restore();

    if (selection.kind === "artifact") {
      context.strokeStyle = "#6f9cff";
      context.lineWidth = 3;
      context.strokeRect(OFFSET_X - 6, OFFSET_Y - 6, 652, 412);
    }
  }, [flat, selection, themeRevision]);

  const selectAt = (clientX: number, clientY: number): void => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    canvas.focus();
    const bounds = canvas.getBoundingClientRect();
    const x = ((clientX - bounds.left) / bounds.width) * WIDTH - OFFSET_X;
    const y = ((clientY - bounds.top) / bounds.height) * HEIGHT - OFFSET_Y;
    const cachedHit = cached.hitTest(x, y);
    const naiveHit = naive.hitTest(x, y);
    const agrees = JSON.stringify(cachedHit) === JSON.stringify(naiveHit);
    setProbe(
      `(${x.toFixed(0)}, ${y.toFixed(0)}) → ${cachedHit?.path.join(" › ") ?? "miss"} · oracle ${agrees ? "✓" : "✕"}`,
    );
    setSelection((current) => resolveClick(tree, current, cachedHit?.path ?? []));
  };

  return (
    <div className="demo-stage demo-stage--interaction">
      <canvas
        ref={canvasRef}
        className="demo-canvas"
        tabIndex={0}
        aria-label="Nested interaction-tree hit testing"
        onPointerDown={(event) => {
          selectAt(event.clientX, event.clientY);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          setSelection((current) => escapeToParent(tree, current));
        }}
      />
      <div className="demo-status" aria-live="polite">
        <span>
          selection <strong>{selectionText(selection)}</strong>
        </span>
        <span>{probe}</span>
        <button
          type="button"
          onClick={() => {
            setSelection((current) => escapeToParent(tree, current));
          }}
        >
          Esc · parent
        </button>
      </div>
    </div>
  );
}
