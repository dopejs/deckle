# ADR 0004: Require the @dopejs/canvas-* package namespace

- Status: accepted
- Date: 2026-08-16
- Owners: repository owners

## Context

The repository will contain multiple independently testable libraries and private applications. A
consistent namespace makes ownership and dependency intent visible.

## Decision

Every workspace package under `packages/` and `apps/` uses a name beginning with `@dopejs/canvas-`.
The private repository root is named `dope-canvas-workspace` because it is not a published
JavaScript library. CI enforces the rule.

## Alternatives

- `@dopejs/dope-canvas-*`: redundant project prefix.
- Mixed scoped and unscoped names: ambiguous ownership and accidental publication risk.
- `@dopejs/canvas` facade exception: conflicts with the explicit all-library naming rule.

## Consequences

Any future facade must also use the prefix, for example `@dopejs/canvas-kit`. Package creation fails
the repository gate until the name is compliant.

## Failure modes

Tools or examples create package manifests outside the checked workspace directories. Review and
workspace configuration remain secondary controls.

## Rollback

Changing the rule requires an ADR and a coordinated package migration before public release.

## Verification

`pnpm packages:check` and its unit tests run in CI.
