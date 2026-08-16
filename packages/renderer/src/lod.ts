/**
 * Level-of-detail policy (design §11). Thresholds are explicit inputs; the
 * defaults follow the suggested policy and are subject to M0 evidence.
 */
export type LodLevel = "live-or-full" | "full-snapshot" | "reduced-snapshot" | "placeholder";

export interface LodThresholds {
  /** Zoom at or above which artifacts may be live or full resolution. */
  readonly fullZoom: number;
  /** Zoom at or above which full snapshots (deferred live) are used. */
  readonly snapshotZoom: number;
  /** Zoom at or above which reduced snapshots are used; below is placeholder. */
  readonly reducedZoom: number;
}

export const DEFAULT_LOD_THRESHOLDS: LodThresholds = {
  fullZoom: 0.75,
  snapshotZoom: 0.4,
  reducedZoom: 0.1,
};

export function selectLod(
  zoom: number,
  thresholds: LodThresholds = DEFAULT_LOD_THRESHOLDS,
): LodLevel {
  if (!Number.isFinite(zoom) || zoom <= 0) {
    throw new RangeError(`zoom must be a positive finite number, got ${zoom}`);
  }
  if (
    !(thresholds.fullZoom > thresholds.snapshotZoom) ||
    !(thresholds.snapshotZoom > thresholds.reducedZoom) ||
    thresholds.reducedZoom <= 0
  ) {
    throw new RangeError("LOD thresholds must satisfy fullZoom > snapshotZoom > reducedZoom > 0");
  }
  if (zoom >= thresholds.fullZoom) return "live-or-full";
  if (zoom >= thresholds.snapshotZoom) return "full-snapshot";
  if (zoom >= thresholds.reducedZoom) return "reduced-snapshot";
  return "placeholder";
}

/**
 * Snapshot resolution policy: capture at effective on-screen resolution,
 * clamped by the texture dimension quota. Returns the scale relative to the
 * artifact's CSS pixel size.
 */
export function selectSnapshotScale(
  zoom: number,
  devicePixelRatio: number,
  cssWidth: number,
  cssHeight: number,
  maxTextureDimension: number,
): number {
  if (!Number.isFinite(zoom) || zoom <= 0) throw new RangeError(`invalid zoom ${zoom}`);
  if (!Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) {
    throw new RangeError(`invalid devicePixelRatio ${devicePixelRatio}`);
  }
  if (cssWidth < 0 || cssHeight < 0) throw new RangeError("css size must be non-negative");
  if (!Number.isInteger(maxTextureDimension) || maxTextureDimension < 1) {
    throw new RangeError(`invalid maxTextureDimension ${maxTextureDimension}`);
  }
  const ideal = Math.min(zoom, 1) * devicePixelRatio;
  const longest = Math.max(cssWidth, cssHeight);
  if (longest === 0) return ideal;
  const clamp = maxTextureDimension / (longest * ideal);
  return clamp >= 1 ? ideal : ideal * clamp;
}
