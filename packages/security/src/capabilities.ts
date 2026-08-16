/**
 * Capability grants for artifact runtimes (design §9, §12). The set is
 * closed-world: a capability that is not present is denied, and grant sets are
 * immutable after construction so a runtime cannot widen its own authority.
 */
export type Capability =
  | "network:fetch"
  | "storage:artifact-state"
  | "timers"
  | "clipboard:read"
  | "clipboard:write"
  | "background-execution";

export const ALL_CAPABILITIES: readonly Capability[] = [
  "network:fetch",
  "storage:artifact-state",
  "timers",
  "clipboard:read",
  "clipboard:write",
  "background-execution",
];

export class CapabilityDeniedError extends Error {
  readonly capability: Capability;

  constructor(capability: Capability) {
    super(`Capability "${capability}" was not granted`);
    this.name = "CapabilityDeniedError";
    this.capability = capability;
  }
}

export class CapabilitySet {
  readonly #granted: ReadonlySet<Capability>;

  constructor(granted: Iterable<Capability> = []) {
    const set = new Set<Capability>();
    for (const capability of granted) {
      if (!ALL_CAPABILITIES.includes(capability)) {
        throw new RangeError(`Unknown capability "${String(capability)}"`);
      }
      set.add(capability);
    }
    this.#granted = set;
  }

  has(capability: Capability): boolean {
    return this.#granted.has(capability);
  }

  assert(capability: Capability): void {
    if (!this.has(capability)) throw new CapabilityDeniedError(capability);
  }

  list(): readonly Capability[] {
    return [...this.#granted];
  }

  /** Derive a narrower set; requesting anything not already granted throws. */
  restrict(subset: Iterable<Capability>): CapabilitySet {
    const requested = new CapabilitySet(subset);
    for (const capability of requested.list()) {
      this.assert(capability);
    }
    return requested;
  }
}
