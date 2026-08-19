# ADR 0006: Use `@dopejs/deckle` as the public entry package

- Status: accepted
- Date: 2026-08-19
- Owners: repository owners
- Supersedes: the entry-package portion of [ADR 0005](0005-rename-to-deckle.md)

## Context

The first Deckle release exposed the scene store and camera package as `@dopejs/deckle-core`. That
name makes the primary package look like an implementation detail and forces consumers to know the
internal package layout before importing the main API.

## Decision

The package in `packages/core` is published as `@dopejs/deckle`. It remains the same implementation
and keeps its existing exports. All other public libraries retain the `@dopejs/deckle-*` namespace.
The package-name check accepts exactly `@dopejs/deckle` or a name beginning with `@dopejs/deckle-`;
near matches such as `@dopejs/decklex` are invalid.

The rename is released as `0.5.0`. Consumers of `@dopejs/deckle-core` replace that dependency and
import with `@dopejs/deckle`. There is no second package or compatibility facade, so the old name
cannot silently install a duplicate Scene Store.

## Consequences

The entry package is discoverable from the npm scope and documentation. Internal workspace paths
remain directory-based, so the repository does not need a filesystem rename. Renderer, website,
playground, documentation, and the package smoke test all import the new entry name.

The release workflow publishes the public packages with provenance. Publishing requires the
repository `NPM_TOKEN`; local development without npm credentials remains fully verifiable through
`pnpm build` and `pnpm packages:smoke`.

## Rollback

Revert the rename commit only before `0.5.0` is published. Once `@dopejs/deckle@0.5.0` is published,
it remains available; npm unpublish is not a rollback mechanism.
