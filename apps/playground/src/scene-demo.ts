import type { ArtifactFrame } from "@dopejs/deckle-protocol";
import { SceneStore } from "@dopejs/deckle";
import { createSeededRandom } from "@dopejs/deckle-spatial";

/**
 * Deterministic demo scene shared by the playground stories: seeded artifact
 * clusters so every reload (and every test) sees the same world.
 */
export interface DemoArtifact {
  readonly id: string;
  readonly title: string;
  readonly hue: number;
  readonly frame: ArtifactFrame;
}

export interface DemoScene {
  readonly store: SceneStore;
  readonly artifacts: ReadonlyMap<string, DemoArtifact>;
}

const TITLES = [
  "Chart",
  "Report",
  "Landing",
  "Dashboard",
  "Form",
  "Invoice",
  "Gallery",
  "Notes",
  "Timeline",
  "Widget",
];

export function buildDemoScene(seed: number, artifactCount: number, clusterCount = 8): DemoScene {
  if (!Number.isInteger(artifactCount) || artifactCount < 0) {
    throw new RangeError(`artifactCount must be a non-negative integer, got ${artifactCount}`);
  }
  if (!Number.isInteger(clusterCount) || clusterCount < 1) {
    throw new RangeError(`clusterCount must be a positive integer, got ${clusterCount}`);
  }
  const random = createSeededRandom(seed);
  const clusters = Array.from({ length: clusterCount }, () => ({
    x: (random() - 0.5) * 12_000,
    y: (random() - 0.5) * 12_000,
  }));

  const store = new SceneStore();
  const artifacts = new Map<string, DemoArtifact>();
  store.transact((tx) => {
    for (let index = 0; index < artifactCount; index += 1) {
      const cluster = clusters[index % clusterCount] as { x: number; y: number };
      const id = `artifact-${index}`;
      const frame: ArtifactFrame = {
        x: cluster.x + (random() - 0.5) * 2_400,
        y: cluster.y + (random() - 0.5) * 2_400,
        width: 160 + random() * 240,
        height: 120 + random() * 180,
        zIndex: index % 7,
      };
      tx.createArtifact(id, frame);
      artifacts.set(id, {
        id,
        title: `${TITLES[index % TITLES.length] as string} ${index}`,
        hue: Math.floor(random() * 360),
        frame,
      });
    }
  });
  return { store, artifacts };
}

export function artifactFillStyle(hue: number, selected: boolean): string {
  return `hsl(${hue} 60% ${selected ? 78 : 88}%)`;
}

export function artifactStrokeStyle(hue: number, selected: boolean): string {
  return selected ? `hsl(${hue} 80% 35%)` : `hsl(${hue} 40% 60%)`;
}
