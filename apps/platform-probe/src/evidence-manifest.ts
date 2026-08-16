import { canonicalStringify, SerializationError } from "@dopejs/canvas-artifact";
import type { CapabilityReport } from "./capability-report.js";

/**
 * Evidence manifest for M0 probe runs (plan §4.5, §12). The gate requires
 * automated probe collection plus this manifest; a demo video or manual
 * impression is not sufficient. Simulated environments are always visibly
 * marked and can never satisfy the M0 exit gate.
 */
export const EVIDENCE_MANIFEST_FORMAT_VERSION = 1 as const;

export interface MeasurementSample {
  readonly name: string;
  readonly unit: "ms" | "bytes" | "count";
  readonly samples: readonly number[];
}

export interface EvidenceManifest {
  readonly formatVersion: typeof EVIDENCE_MANIFEST_FORMAT_VERSION;
  readonly commit: string;
  readonly dirty: boolean;
  readonly collectedAtIso: string;
  readonly toolchain: string;
  readonly browser: {
    readonly name: string;
    readonly version: string;
    readonly flags: readonly string[];
  };
  readonly os: string;
  readonly gpu: string | null;
  readonly capabilityReport: CapabilityReport;
  readonly measurements: readonly MeasurementSample[];
  readonly exclusions: readonly string[];
}

export class EvidenceManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceManifestError";
  }
}

const COMMIT_PATTERN = /^[0-9a-f]{7,40}$/;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function validateEvidenceManifest(manifest: EvidenceManifest): void {
  // Manifests may arrive from persisted JSON; do not trust the static type.
  const formatVersion: unknown = manifest.formatVersion;
  if (formatVersion !== EVIDENCE_MANIFEST_FORMAT_VERSION) {
    throw new EvidenceManifestError(`unsupported manifest format version ${String(formatVersion)}`);
  }
  if (!COMMIT_PATTERN.test(manifest.commit)) {
    throw new EvidenceManifestError(`commit must be a hex SHA, got "${manifest.commit}"`);
  }
  if (!ISO_PATTERN.test(manifest.collectedAtIso)) {
    throw new EvidenceManifestError(
      `collectedAtIso must be ISO-8601, got "${manifest.collectedAtIso}"`,
    );
  }
  if (!manifest.toolchain || !manifest.browser.name || !manifest.browser.version || !manifest.os) {
    throw new EvidenceManifestError("toolchain, browser, and os identification are required");
  }
  for (const measurement of manifest.measurements) {
    if (!measurement.name) throw new EvidenceManifestError("measurement name is required");
    if (measurement.samples.length === 0) {
      throw new EvidenceManifestError(`measurement "${measurement.name}" has no samples`);
    }
    for (const sample of measurement.samples) {
      if (!Number.isFinite(sample)) {
        throw new EvidenceManifestError(`measurement "${measurement.name}" has non-finite samples`);
      }
    }
  }
}

/** True only for manifests eligible to satisfy the M0 evidence gate. */
export function isGateEligible(manifest: EvidenceManifest): boolean {
  return !manifest.capabilityReport.simulated && !manifest.dirty;
}

export function serializeEvidenceManifest(manifest: EvidenceManifest): string {
  validateEvidenceManifest(manifest);
  return canonicalStringify(manifest);
}

export function deserializeEvidenceManifest(payload: string): EvidenceManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    throw new SerializationError(`manifest payload is not valid JSON: ${String(error)}`);
  }
  const manifest = parsed as EvidenceManifest;
  validateEvidenceManifest(manifest);
  return manifest;
}
