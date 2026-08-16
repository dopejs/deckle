/**
 * HTML-in-Canvas capability detection (plan §4.1, design §14). Detection is
 * fail closed: an API is reported supported only when it is affirmatively
 * present on the provided environment. The environment is injected so probes
 * run identically in a real browser and in simulated unit tests, and so a
 * mocked global can never masquerade as real platform evidence — the manifest
 * records whether the environment was simulated.
 */
export const CAPABILITY_REPORT_FORMAT_VERSION = 1 as const;

export interface ProbeEnvironment {
  /** True when the environment is a test double, recorded in the report. */
  readonly simulated: boolean;
  readonly userAgent: string | null;
  /** Prototype-like objects probed for API members. Null when unavailable. */
  readonly canvasRenderingContext2D: object | null;
  readonly htmlCanvasElement: object | null;
  readonly webgl2RenderingContext: object | null;
  readonly gpuDevice: object | null;
}

export type CapabilityStatus =
  | { readonly supported: true; readonly source: string }
  | { readonly supported: false; readonly reason: string };

export interface CapabilityReport {
  readonly formatVersion: typeof CAPABILITY_REPORT_FORMAT_VERSION;
  readonly simulated: boolean;
  readonly userAgent: string | null;
  readonly capabilities: {
    readonly layoutSubtree: CapabilityStatus;
    readonly drawElementImage: CapabilityStatus;
    readonly captureElementImage: CapabilityStatus;
    readonly webglElementTexture: CapabilityStatus;
    readonly webgpuElementTexture: CapabilityStatus;
  };
  /** Selected tier per design §14, derived from the capabilities above. */
  readonly selectedTier: "native-html-in-canvas" | "dom-overlay-fallback";
}

function probeMember(host: object | null, member: string, source: string): CapabilityStatus {
  if (host === null) return { supported: false, reason: `${source} unavailable` };
  return member in host
    ? { supported: true, source }
    : { supported: false, reason: `${source}.${member} missing` };
}

export function detectCapabilities(environment: ProbeEnvironment): CapabilityReport {
  const layoutSubtree = probeMember(
    environment.htmlCanvasElement,
    "layoutsubtree",
    "HTMLCanvasElement",
  );
  const drawElementImage = probeMember(
    environment.canvasRenderingContext2D,
    "drawElementImage",
    "CanvasRenderingContext2D",
  );
  const captureElementImage = probeMember(
    environment.canvasRenderingContext2D,
    "captureElementImage",
    "CanvasRenderingContext2D",
  );
  const webglElementTexture = probeMember(
    environment.webgl2RenderingContext,
    "texElementImage2D",
    "WebGL2RenderingContext",
  );
  const webgpuElementTexture = probeMember(
    environment.gpuDevice,
    "importExternalElement",
    "GPUDevice",
  );

  const nativeTier =
    layoutSubtree.supported && drawElementImage.supported && captureElementImage.supported;

  return {
    formatVersion: CAPABILITY_REPORT_FORMAT_VERSION,
    simulated: environment.simulated,
    userAgent: environment.userAgent,
    capabilities: {
      layoutSubtree,
      drawElementImage,
      captureElementImage,
      webglElementTexture,
      webgpuElementTexture,
    },
    selectedTier: nativeTier ? "native-html-in-canvas" : "dom-overlay-fallback",
  };
}

/** Build the environment from real browser globals. Never used in unit tests. */
export function browserProbeEnvironment(globals: Record<string, unknown>): ProbeEnvironment {
  const prototypeOf = (name: string): object | null => {
    const ctor = globals[name];
    if (typeof ctor !== "function") return null;
    const proto: unknown = (ctor as { prototype?: unknown }).prototype;
    return typeof proto === "object" && proto !== null ? proto : null;
  };
  const navigator = globals["navigator"] as { userAgent?: unknown } | undefined;
  return {
    simulated: false,
    userAgent: typeof navigator?.userAgent === "string" ? navigator.userAgent : null,
    canvasRenderingContext2D: prototypeOf("CanvasRenderingContext2D"),
    htmlCanvasElement: prototypeOf("HTMLCanvasElement"),
    webgl2RenderingContext: prototypeOf("WebGL2RenderingContext"),
    gpuDevice: prototypeOf("GPUDevice"),
  };
}
