import type { ArtifactFrame } from "@dopejs/canvas-protocol";
import { worldToScreen, type Camera } from "@dopejs/canvas-core";
import type { RetainedPicture } from "./picture.js";

/**
 * Reference compositor. Camera-only movement recomputes screen transforms for
 * retained pictures; it never touches picture content, which is the M1 gate
 * "camera-only pan/zoom does not rebuild artifact content" expressed as a
 * contract: the output holds the same picture references it was given.
 */
export interface CompositionItem {
  readonly artifactId: string;
  readonly frame: ArtifactFrame;
  readonly picture: RetainedPicture;
}

export interface DrawCommand {
  readonly artifactId: string;
  readonly picture: RetainedPicture;
  /** Screen-space placement in CSS pixels. */
  readonly screenX: number;
  readonly screenY: number;
  readonly screenWidth: number;
  readonly screenHeight: number;
  readonly zIndex: number;
}

export interface CompositionFrame {
  readonly commands: readonly DrawCommand[];
}

export function composeFrame(camera: Camera, items: readonly CompositionItem[]): CompositionFrame {
  const commands = items
    .map((item) => {
      const topLeft = worldToScreen(camera, { x: item.frame.x, y: item.frame.y });
      return {
        artifactId: item.artifactId,
        picture: item.picture,
        screenX: topLeft.x,
        screenY: topLeft.y,
        screenWidth: item.frame.width * camera.zoom,
        screenHeight: item.frame.height * camera.zoom,
        zIndex: item.frame.zIndex,
      };
    })
    .sort(
      (left, right) =>
        left.zIndex - right.zIndex ||
        (left.artifactId < right.artifactId ? -1 : left.artifactId > right.artifactId ? 1 : 0),
    );
  return { commands };
}
