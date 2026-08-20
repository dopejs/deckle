import { createCamera, panCamera, worldToScreen, type Camera } from "@dopejs/deckle";
import { createSeededRandom } from "@dopejs/deckle-spatial";

/**
 * Ambient hero background driven by the real engine camera: pastel artifact
 * frames drift under a slow diagonal pan. Honors prefers-reduced-motion by
 * rendering a single static frame.
 */
interface HeroCard {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly hue: number;
}

const WORLD_TILE = 4000;

function buildCards(seed: number, count: number): HeroCard[] {
  const random = createSeededRandom(seed);
  return Array.from({ length: count }, () => ({
    x: random() * WORLD_TILE,
    y: random() * WORLD_TILE,
    width: 140 + random() * 220,
    height: 90 + random() * 150,
    hue: Math.floor(random() * 360),
  }));
}

export function mountHeroCanvas(
  canvas: HTMLCanvasElement,
  coordReadout: HTMLElement | null,
): (() => void) | undefined {
  const context = canvas.getContext("2d");
  if (!context) return;
  const cards = buildCards(2026, 42);
  const dpr = Math.max(1, Math.min(3, globalThis.devicePixelRatio || 1));
  let camera: Camera = createCamera({
    x: 400,
    y: 300,
    zoom: 0.9,
    viewportWidth: 1,
    viewportHeight: 1,
  });

  const resize = (): void => {
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    camera = createCamera({ ...camera, viewportWidth: rect.width, viewportHeight: rect.height });
  };

  const draw = (): void => {
    const dark = document.documentElement.dataset.theme === "dark";
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, camera.viewportWidth, camera.viewportHeight);
    for (const card of cards) {
      // Tile the world so the slow pan never runs out of content.
      const tileX = Math.floor((camera.x - card.x) / WORLD_TILE + 0.5) * WORLD_TILE;
      const tileY = Math.floor((camera.y - card.y) / WORLD_TILE + 0.5) * WORLD_TILE;
      const screen = worldToScreen(camera, { x: card.x + tileX, y: card.y + tileY });
      const width = card.width * camera.zoom;
      const height = card.height * camera.zoom;
      if (
        screen.x + width < -50 ||
        screen.y + height < -50 ||
        screen.x > camera.viewportWidth + 50 ||
        screen.y > camera.viewportHeight + 50
      ) {
        continue;
      }
      context.fillStyle = dark ? `hsl(${card.hue} 24% 18%)` : `hsl(${card.hue} 55% 91%)`;
      context.strokeStyle = dark ? `hsl(${card.hue} 22% 32%)` : `hsl(${card.hue} 30% 78%)`;
      context.lineWidth = 1;
      context.beginPath();
      context.roundRect(screen.x, screen.y, width, height, 8);
      context.fill();
      context.stroke();
    }
    if (coordReadout) {
      coordReadout.textContent = `camera (${camera.x.toFixed(0)}, ${camera.y.toFixed(0)}) · zoom 0.90`;
    }
  };

  resize();
  draw();
  const onResize = (): void => {
    resize();
    draw();
  };
  globalThis.addEventListener("resize", onResize);
  const themeObserver = new MutationObserver(draw);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });

  if (globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return () => {
      globalThis.removeEventListener("resize", onResize);
      themeObserver.disconnect();
    };
  }

  let last = performance.now();
  let animationFrame = 0;
  const tick = (now: number): void => {
    const dt = Math.min(now - last, 100) / 1000;
    last = now;
    camera = panCamera(camera, 14 * dt, 9 * dt);
    draw();
    animationFrame = requestAnimationFrame(tick);
  };
  animationFrame = requestAnimationFrame(tick);
  return () => {
    globalThis.removeEventListener("resize", onResize);
    themeObserver.disconnect();
    cancelAnimationFrame(animationFrame);
  };
}
