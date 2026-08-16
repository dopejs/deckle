# Contributing

dope-canvas is in pre-development. Early contributions should strengthen probes, contracts,
fixtures, measurements, and design evidence rather than add broad compatibility code without a
validated milestone need.

## Setup

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm build
```

If a future change adds Rust, use the repository commands rather than bare Cargo commands:

```bash
pnpm rust:check
pnpm rust:test
pnpm rust:clippy
```

They remove Cargo build artifacts after every run. This intentionally trades some local rebuild
speed for bounded disk usage and predictable CI cleanup.

## Pull requests

A change should include:

- the user or engineering problem;
- the affected design invariant or milestone;
- tests or probe evidence;
- compatibility and security impact;
- new resource ownership and cleanup behavior;
- rollback or feature-flag strategy for experimental browser behavior.

Do not claim support based only on a mocked API, a screenshot, an average FPS number, or one desktop
browser run. Browser and device evidence must follow the
[benchmark protocol](docs/benchmark-protocol.md).

## Package names

All workspace package names must start with `@dopejs/canvas-`. Run `pnpm packages:check` before
submitting a new package.

## Decisions

Use [`docs/adr/0000-template.md`](docs/adr/0000-template.md) for changes to architecture,
compatibility, security boundaries, lifecycle, public APIs, or milestone gates.
