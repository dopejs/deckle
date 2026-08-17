import {
  createInteractionTree,
  matrixApply,
  matrixMultiply,
  matrixRotate,
  matrixTranslate,
  type InteractionNode,
  type InteractionTree,
  type Mat2D,
} from "@dopejs/canvas-artifact";
import {
  CachedHitTester,
  escapeToParent,
  NaiveHitTester,
  NO_SELECTION,
  resolveClick,
  type EditorSelection,
} from "@dopejs/canvas-editor";
import { createHiDpiCanvas } from "./hidpi.js";

export default {
  title: "Hit Testing",
};

const IDENTITY: Mat2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

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

interface FlatNode {
  readonly node: InteractionNode;
  readonly world: Mat2D;
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

/**
 * Retained interaction tree with nested transforms, a clipping panel, and a
 * rotated node. Click to progressively refine the selection (Figma-style),
 * press Escape to go back up. The HUD proves the cached tester and the naive
 * oracle agree on every probe.
 */
export const Nested_Selection = (): HTMLElement => {
  const root = document.createElement("div");
  root.style.cssText = "font: 12px system-ui; position: relative;";
  const { canvas, context, clear } = createHiDpiCanvas(720, 460);
  canvas.style.cssText += "border: 1px solid #ccc; border-radius: 6px;";
  canvas.tabIndex = 0;
  const hud = document.createElement("div");
  hud.style.cssText = "margin-top: 6px; white-space: pre; color: #333;";
  root.append(canvas, hud);

  const tree = fixtureTree();
  const cached = new CachedHitTester(tree);
  const naive = new NaiveHitTester(tree);
  const flat = flatten(tree);
  let selection: EditorSelection = NO_SELECTION;
  let lastProbe = "none yet";

  const offsetX = 30;
  const offsetY = 30;

  const draw = (): void => {
    clear();
    context.save();
    context.translate(offsetX, offsetY);
    for (const { node, world } of flat) {
      const selected = selection.kind === "node" && selection.nodeId === node.id;
      context.save();
      context.transform(world.a, world.b, world.c, world.d, world.e, world.f);
      if (node.clip) {
        context.strokeStyle = "#bbb";
        context.setLineDash([4, 3]);
        context.strokeRect(
          node.clip.rect.x,
          node.clip.rect.y,
          node.clip.rect.width,
          node.clip.rect.height,
        );
        context.setLineDash([]);
      }
      context.fillStyle = selected ? "hsl(215 80% 85%)" : "hsl(215 30% 95%)";
      context.strokeStyle = selected ? "hsl(215 80% 40%)" : "hsl(215 20% 65%)";
      context.lineWidth = selected ? 3 : 1;
      context.fillRect(node.bounds.x, node.bounds.y, node.bounds.width, node.bounds.height);
      context.strokeRect(node.bounds.x, node.bounds.y, node.bounds.width, node.bounds.height);
      context.fillStyle = "#234";
      context.font = "12px system-ui";
      context.fillText(node.id, node.bounds.x + 6, node.bounds.y + 16);
      context.restore();
    }
    context.restore();

    const artifactSelected = selection.kind === "artifact";
    if (artifactSelected) {
      context.strokeStyle = "hsl(215 80% 40%)";
      context.lineWidth = 3;
      context.strokeRect(offsetX - 6, offsetY - 6, 652, 412);
    }

    hud.textContent = `selection: ${
      selection.kind === "node"
        ? `node "${selection.nodeId}"`
        : selection.kind === "artifact"
          ? "artifact frame"
          : "none"
    }  (Escape to go up)\n${lastProbe}`;
  };

  canvas.addEventListener("pointerdown", (event) => {
    canvas.focus();
    const x = event.offsetX - offsetX;
    const y = event.offsetY - offsetY;
    const cachedHit = cached.hitTest(x, y);
    const naiveHit = naive.hitTest(x, y);
    const agree = JSON.stringify(cachedHit) === JSON.stringify(naiveHit);
    lastProbe =
      `probe (${x.toFixed(0)}, ${y.toFixed(0)}) → ` +
      `${cachedHit ? cachedHit.path.join(" › ") : "miss"}  ` +
      `[oracle ${agree ? "agrees ✓" : "DISAGREES ✗"}]`;
    selection = resolveClick(tree, selection, cachedHit ? cachedHit.path : []);
    draw();
  });
  canvas.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      selection = escapeToParent(tree, selection);
      draw();
    }
  });

  draw();
  return root;
};

/** Verify a rotated node's local-space math visually: the probe dot maps into the badge's local coordinates. */
export const Rotated_Local_Space = (): HTMLElement => {
  const root = document.createElement("div");
  root.style.cssText = "font: 12px system-ui;";
  const tree = fixtureTree();
  const badge = tree.nodes.find((node) => node.id === "rotated-badge");
  const list = document.createElement("pre");
  list.style.cssText = "background: #f6f6f6; padding: 10px; border-radius: 6px;";
  if (badge) {
    const samples = [
      { x: 430, y: 100 },
      { x: 500, y: 130 },
      { x: 300, y: 300 },
    ];
    const tester = new CachedHitTester(tree);
    list.textContent = samples
      .map((sample) => {
        const hit = tester.hitTest(sample.x, sample.y);
        const local = matrixApply(
          {
            a: badge.transform.a,
            b: -badge.transform.b,
            c: -badge.transform.c,
            d: badge.transform.d,
            e: 0,
            f: 0,
          },
          sample.x - badge.transform.e,
          sample.y - badge.transform.f,
        );
        return (
          `world (${sample.x}, ${sample.y}) → local (${local.x.toFixed(1)}, ${local.y.toFixed(1)}) → ` +
          `${hit ? hit.nodeId : "miss"}`
        );
      })
      .join("\n");
  }
  root.append(list);
  return root;
};
