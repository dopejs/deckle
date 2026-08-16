# ADR 0005: Bound and clean Cargo build artifacts

- Status: accepted before Rust adoption
- Date: 2026-08-16
- Owners: repository owners

## Context

Rust target directories can grow to multiple gigabytes across profiles, targets, and incremental
builds. The project may adopt Rust/WASM later, but uncontrolled local artifacts must not consume
unbounded developer or CI disk.

## Decision

Rust is optional and evidence-driven. When present, supported commands run through pnpm wrappers
that set `CARGO_TARGET_DIR` to `.cache/cargo-target`, disable incremental artifacts, and remove the
directory in a `finally` path on success or failure. A repository gate rejects more than 256 MiB of
residual Cargo artifacts, including a direct root `target/`.

## Alternatives

- **Keep incremental target forever:** faster rebuilds but violates the disk constraint.
- **Rely on manual cargo clean:** not deterministic and commonly forgotten after failures.
- **Use a global shared target:** risks cross-project coupling and still grows without ownership.

## Consequences

Local Rust rebuilds are slower. Disk usage and CI cleanup are deterministic. Future caching must use
bounded external CI caches rather than retained workspace artifacts.

## Failure modes

Developers run bare Cargo commands, a process crash interrupts cleanup, or another tool overrides
the target directory.

## Rollback

The limit or cleanup policy may change only with measured build-time/disk evidence and an equally
bounded replacement.

## Verification

`pnpm rust:check`, `pnpm rust:test`, `pnpm rust:clippy`, and `pnpm rust:artifacts:check`; CI checks
the residual footprint after all jobs.
