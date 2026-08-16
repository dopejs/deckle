import { INTERACTION_TREE_FORMAT_VERSION, type InteractionTree } from "./interaction-tree.js";

/** JSON-like durable state; functions, symbols, and cycles are rejected. */
export type DurableState =
  | null
  | boolean
  | number
  | string
  | readonly DurableState[]
  | { readonly [key: string]: DurableState };

export class SerializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SerializationError";
  }
}

/**
 * Canonical JSON: object keys sorted, no whitespace variance, rejects
 * non-finite numbers, undefined, functions, and cycles. Equal logical values
 * always produce byte-identical output, which makes revision comparison and
 * content hashing deterministic.
 */
export function canonicalStringify(value: unknown): string {
  const seen = new Set<object>();
  const encode = (input: unknown): string => {
    if (input === null) return "null";
    switch (typeof input) {
      case "boolean":
        return input ? "true" : "false";
      case "number":
        if (!Number.isFinite(input)) {
          throw new SerializationError(`non-finite number ${input} is not serializable`);
        }
        return Object.is(input, -0) ? "0" : JSON.stringify(input);
      case "string":
        return JSON.stringify(input);
      case "bigint":
      case "symbol":
      case "undefined":
      case "function":
        throw new SerializationError(`value of type ${typeof input} is not serializable`);
      case "object": {
        const obj = input;
        if (seen.has(obj)) throw new SerializationError("cyclic value is not serializable");
        seen.add(obj);
        let result: string;
        if (Array.isArray(obj)) {
          result = `[${obj.map((item) => encode(item)).join(",")}]`;
        } else {
          const entries = Object.entries(obj as Record<string, unknown>)
            .filter(([, item]) => item !== undefined)
            .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
            .map(([key, item]) => `${JSON.stringify(key)}:${encode(item)}`);
          result = `{${entries.join(",")}}`;
        }
        seen.delete(obj);
        return result;
      }
    }
    throw new SerializationError(`value of type ${typeof input} is not serializable`);
  };
  return encode(value);
}

export function assertDurableState(value: unknown): asserts value is DurableState {
  canonicalStringify(value);
}

export type ArtifactSourceKind = "html" | "structured";

export interface ArtifactSource {
  readonly kind: ArtifactSourceKind;
  readonly content: string;
}

export const ARTIFACT_BUNDLE_FORMAT_VERSION = 1 as const;

/**
 * Durable, transferable artifact record: everything needed to restore an
 * artifact except paint caches, which are recomputable.
 */
export interface ArtifactBundle {
  readonly formatVersion: typeof ARTIFACT_BUNDLE_FORMAT_VERSION;
  readonly artifactId: string;
  readonly sourceRevision: number;
  readonly stateRevision: number;
  readonly source: ArtifactSource;
  readonly state: DurableState;
  readonly interactionTree: InteractionTree | null;
}

export function serializeArtifactBundle(bundle: ArtifactBundle): string {
  validateBundle(bundle);
  return canonicalStringify(bundle);
}

export function deserializeArtifactBundle(payload: string): ArtifactBundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    throw new SerializationError(`artifact bundle payload is not valid JSON: ${String(error)}`);
  }
  const bundle = parsed as ArtifactBundle;
  validateBundle(bundle);
  return bundle;
}

function validateBundle(bundle: ArtifactBundle): void {
  // Bundles typically arrive from JSON.parse, so the static type is a claim,
  // not a fact: validate through an untyped view.
  const rawValue: unknown = bundle;
  if (typeof rawValue !== "object" || rawValue === null) {
    throw new SerializationError("artifact bundle must be an object");
  }
  const raw = rawValue as Record<string, unknown>;
  if (raw["formatVersion"] !== ARTIFACT_BUNDLE_FORMAT_VERSION) {
    throw new SerializationError(
      `unsupported artifact bundle format version ${String(raw["formatVersion"])}`,
    );
  }
  if (typeof raw["artifactId"] !== "string" || raw["artifactId"].length === 0) {
    throw new SerializationError("artifact bundle requires a non-empty artifactId");
  }
  for (const key of ["sourceRevision", "stateRevision"]) {
    const value = raw[key];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
      throw new SerializationError(`artifact bundle ${key} must be a non-negative integer`);
    }
  }
  const source = raw["source"] as Record<string, unknown> | null;
  if (
    typeof source !== "object" ||
    source === null ||
    (source["kind"] !== "html" && source["kind"] !== "structured") ||
    typeof source["content"] !== "string"
  ) {
    throw new SerializationError("artifact bundle source must be {kind: html|structured, content}");
  }
  assertDurableState(raw["state"]);
  const treeValue: unknown = raw["interactionTree"];
  if (treeValue !== null) {
    if (typeof treeValue !== "object") {
      throw new SerializationError(
        "artifact bundle interactionTree must be a matching versioned tree or null",
      );
    }
    const tree = treeValue as Record<string, unknown>;
    if (
      tree["formatVersion"] !== INTERACTION_TREE_FORMAT_VERSION ||
      tree["artifactId"] !== raw["artifactId"] ||
      !Array.isArray(tree["nodes"])
    ) {
      throw new SerializationError(
        "artifact bundle interactionTree must be a matching versioned tree or null",
      );
    }
  }
}

export const HIBERNATION_FORMAT_VERSION = 1 as const;

/**
 * Snapshot of runtime-owned durable state taken when a live artifact
 * hibernates. `runtimeEpoch` records which runtime produced it so a restore
 * can reject records from a runtime that was already replaced.
 */
export interface HibernationRecord {
  readonly formatVersion: typeof HIBERNATION_FORMAT_VERSION;
  readonly artifactId: string;
  readonly sourceRevision: number;
  readonly stateRevision: number;
  readonly runtimeEpoch: number;
  readonly state: DurableState;
}

export function serializeHibernationRecord(record: HibernationRecord): string {
  const raw = record as unknown as Record<string, unknown>;
  if (raw["formatVersion"] !== HIBERNATION_FORMAT_VERSION) {
    throw new SerializationError(
      `unsupported hibernation format version ${String(raw["formatVersion"])}`,
    );
  }
  if (typeof raw["artifactId"] !== "string" || raw["artifactId"].length === 0) {
    throw new SerializationError("hibernation record requires a non-empty artifactId");
  }
  for (const key of ["sourceRevision", "stateRevision", "runtimeEpoch"]) {
    const value = raw[key];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
      throw new SerializationError(`hibernation record ${key} must be a non-negative integer`);
    }
  }
  assertDurableState(raw["state"]);
  return canonicalStringify(record);
}

export function deserializeHibernationRecord(payload: string): HibernationRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    throw new SerializationError(`hibernation payload is not valid JSON: ${String(error)}`);
  }
  const record = parsed as HibernationRecord;
  serializeHibernationRecord(record);
  return record;
}
