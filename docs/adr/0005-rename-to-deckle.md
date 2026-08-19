# ADR 0005: Rename the project to Deckle and move to the @dopejs/deckle-* namespace

- Status: accepted (entry-package naming superseded by [ADR 0006](0006-entry-package-name.md))
- Date: 2026-08-19
- Owners: repository owners
- Supersedes: [ADR 0004](0004-package-namespace.md)

## Context

The project shipped as `dope-canvas` with libraries under `@dopejs/canvas-*`. That name describes
the medium rather than the product. Infinite-canvas editors are a crowded, well-branded category, so
a name built on the word "canvas" files the project alongside tools it is not competing with, while
saying nothing about the property that actually distinguishes it: content appears on the surface
before it is finished, behind a boundary that only ever moves forward.

A deckle is the frame that bounds a sheet of handmade paper while the pulp is still settling; the
ragged untrimmed edge it leaves is a deckle edge. The engine does the same thing — it fixes a frame
around content that has not finished arriving and leaves the boundary visible.

## Decision

The project is named Deckle. Every workspace package under `packages/` and `apps/` uses a name
beginning with `@dopejs/deckle-`, and the private repository root is `deckle-workspace`. CI enforces
the prefix, as it did for the previous one.

`Deckle` is capitalized in prose and lowercase in identifiers, package names, and URLs.

## Alternatives

- **Keep `@dopejs/canvas-*`.** Free, and wrong for the reason above: the cost of a generic name is
  paid continuously in positioning, while the cost of renaming is paid once and is lowest now.
- **`@deckle/*` as its own npm scope.** Shorter, but it abandons the `@dopejs` org identity for no
  functional gain and requires provenance and access to be configured again from scratch.
- **`weft`.** The weaving term for the advancing edge of cloth, the fell line, is an unusually exact
  match for the committed-prefix boundary. Rejected because the unit of this system is a bounded
  frame, not an interlaced thread, and the metaphor would suggest a stream-merging library.

## Consequences

`0.3.0` is the last release under `@dopejs/canvas-*`. The renamed packages are first published at
`0.4.0`; no code changes in that release, so the two names are interchangeable at that version and a
consumer can migrate with a find-and-replace. Each `canvas-*` package is deprecated on npm with a
message naming its replacement — deprecated rather than unpublished, so existing installs keep
resolving.

ADR 0004 required a coordinated migration "before public release", and this migration happens after
one. That is a real deviation from the stated plan. It is acceptable only because the published
surface is two versions old with effectively no dependents, and because deprecation leaves every
already-published artifact installable. The window in which this is cheap is closing, which is the
argument for doing it now rather than deferring again.

The GitHub repository is renamed to `dopejs/deckle`; GitHub redirects the old path, so existing
clones and links keep working. The project site now uses `deckle.dopejs.com`; the canonical URL is
configured in the repository metadata and locale page generator, while DNS and the GitHub Pages
custom-domain setting remain deployment configuration outside this repository.

## Failure modes

A consumer pins `@dopejs/canvas-*` and never sees the deprecation notice, staying on `0.3.0`
indefinitely. That is survivable: `0.3.0` keeps working, it is simply frozen. The worse case is a
consumer installing both namespaces at once and getting two copies of the Scene Store, whose handles
are not interchangeable; the deprecation message names the replacement package explicitly to make
that mistake visible at install time.

## Rollback

Reverting the rename commit restores every `canvas-*` name; the `0.3.0` packages on npm were never
removed, only deprecated, and a deprecation can be cleared with `npm deprecate <pkg>@0.3.0 ""`. The
GitHub repository can be renamed back, with redirects again covering the gap.

## Verification

`pnpm packages:check` enforces the new prefix and its unit tests cover the rule.
`pnpm packages:smoke` installs every renamed package from a pack outside the workspace and imports
it, so a stale reference to an old name fails the release gate rather than reaching npm.
