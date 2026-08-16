import { describe, expect, it } from "vitest";
import {
  browserProbeEnvironment,
  CAPABILITY_REPORT_FORMAT_VERSION,
  detectCapabilities,
  deserializeEvidenceManifest,
  EVIDENCE_MANIFEST_FORMAT_VERSION,
  EvidenceManifestError,
  isGateEligible,
  serializeEvidenceManifest,
  type EvidenceManifest,
  type ProbeEnvironment,
} from "./index.js";

function simulatedEnvironment(overrides: Partial<ProbeEnvironment> = {}): ProbeEnvironment {
  return {
    simulated: true,
    userAgent: "test-agent",
    canvasRenderingContext2D: null,
    htmlCanvasElement: null,
    webgl2RenderingContext: null,
    gpuDevice: null,
    ...overrides,
  };
}

describe("detectCapabilities", () => {
  it("should fail closed when no APIs are present", () => {
    const report = detectCapabilities(simulatedEnvironment());
    expect(report.formatVersion).toBe(CAPABILITY_REPORT_FORMAT_VERSION);
    expect(report.selectedTier).toBe("dom-overlay-fallback");
    for (const status of Object.values(report.capabilities)) {
      expect(status.supported).toBe(false);
    }
  });

  it("should select the native tier only when all core APIs are present", () => {
    const full = detectCapabilities(
      simulatedEnvironment({
        canvasRenderingContext2D: { drawElementImage: () => {}, captureElementImage: () => {} },
        htmlCanvasElement: { layoutsubtree: true },
      }),
    );
    expect(full.selectedTier).toBe("native-html-in-canvas");

    const partial = detectCapabilities(
      simulatedEnvironment({
        canvasRenderingContext2D: { drawElementImage: () => {} },
        htmlCanvasElement: { layoutsubtree: true },
      }),
    );
    expect(partial.selectedTier).toBe("dom-overlay-fallback");
    expect(partial.capabilities.captureElementImage.supported).toBe(false);
  });

  it("should record optional GPU texture capabilities independently", () => {
    const report = detectCapabilities(
      simulatedEnvironment({
        webgl2RenderingContext: { texElementImage2D: () => {} },
        gpuDevice: { importExternalElement: () => {} },
      }),
    );
    expect(report.capabilities.webglElementTexture.supported).toBe(true);
    expect(report.capabilities.webgpuElementTexture.supported).toBe(true);
    expect(report.selectedTier).toBe("dom-overlay-fallback");
  });

  it("should mark simulation status verbatim in the report", () => {
    expect(detectCapabilities(simulatedEnvironment()).simulated).toBe(true);
  });
});

describe("browserProbeEnvironment", () => {
  it("should read prototypes from constructor-like globals and tolerate absence", () => {
    class FakeContext {
      drawElementImage(): void {}
    }
    const environment = browserProbeEnvironment({
      CanvasRenderingContext2D: FakeContext,
      navigator: { userAgent: "UA/1.0" },
    });
    expect(environment.simulated).toBe(false);
    expect(environment.userAgent).toBe("UA/1.0");
    expect(environment.canvasRenderingContext2D).toBe(FakeContext.prototype);
    expect(environment.htmlCanvasElement).toBeNull();
  });
});

describe("evidence manifest", () => {
  const manifest: EvidenceManifest = {
    formatVersion: EVIDENCE_MANIFEST_FORMAT_VERSION,
    commit: "549a837c0ffee",
    dirty: false,
    collectedAtIso: "2026-08-16T10:00:00Z",
    toolchain: "node22.12/pnpm10.33.2",
    browser: { name: "chromium", version: "140.0.0", flags: ["--enable-html-in-canvas"] },
    os: "macOS 15",
    gpu: "Apple M3",
    capabilityReport: detectCapabilities(simulatedEnvironment()),
    measurements: [{ name: "captureMs", unit: "ms", samples: [1.5, 2.25, 1.75] }],
    exclusions: ["webgpu path not measured"],
  };

  it("should round-trip deterministically", () => {
    const payload = serializeEvidenceManifest(manifest);
    const restored = deserializeEvidenceManifest(payload);
    expect(restored).toEqual(manifest);
    expect(serializeEvidenceManifest(restored)).toBe(payload);
  });

  it("should reject malformed manifests", () => {
    expect(() => serializeEvidenceManifest({ ...manifest, commit: "not-a-sha" })).toThrow(
      EvidenceManifestError,
    );
    expect(() => serializeEvidenceManifest({ ...manifest, collectedAtIso: "yesterday" })).toThrow(
      EvidenceManifestError,
    );
    expect(() =>
      serializeEvidenceManifest({
        ...manifest,
        measurements: [{ name: "x", unit: "ms", samples: [] }],
      }),
    ).toThrow(EvidenceManifestError);
    expect(() =>
      serializeEvidenceManifest({
        ...manifest,
        measurements: [{ name: "x", unit: "ms", samples: [Number.NaN] }],
      }),
    ).toThrow(EvidenceManifestError);
    expect(() => deserializeEvidenceManifest("{}")).toThrow(EvidenceManifestError);
  });

  it("should never let simulated or dirty runs satisfy the M0 gate", () => {
    expect(isGateEligible(manifest)).toBe(false); // simulated capability report
    const realReport = { ...manifest.capabilityReport, simulated: false };
    expect(isGateEligible({ ...manifest, capabilityReport: realReport })).toBe(true);
    expect(isGateEligible({ ...manifest, capabilityReport: realReport, dirty: true })).toBe(false);
  });
});
