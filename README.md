# dope-canvas

dope-canvas is a planned infinite-canvas runtime for large collections of AI-generated Web
artifacts. An artifact may originate as HTML, CSS, and controlled JavaScript, while the canvas owns
camera movement, spatial virtualization, live/snapshot lifecycle, interaction metadata, resource
budgets, and rendering composition.

The repository is currently at the **pre-development baseline**. It contains the architecture,
delivery plan, decision records, security and compatibility boundaries, benchmark protocol, and
repository gates. It does not yet contain a working infinite canvas or claim production support for
experimental browser HTML-in-Canvas APIs.

## Why this exists

Keeping hundreds of generated pages alive as iframes scales poorly because every iframe retains a
browsing context, DOM/CSS state, script realm, resources, and rendering state. Flattening every page
to an image saves resources but loses internal selection and event targeting. dope-canvas is
designed around a retained artifact model:

```text
Artifact = source + durable state + interaction tree + paint cache + optional live runtime
```

A snapshot is only a paint cache. The document and interaction model remain available for Figma-like
selection, event routing, activation, and revision-safe restoration.

## Start here

- [Project website](https://dopejs.github.io/dope-canvas/)
- [Interactive playground](https://dopejs.github.io/dope-canvas/playground/)

- [Technical design](docs/design.md)
- [Delivery plan](docs/plan.md)
- [Security model](docs/security.md)
- [Compatibility strategy](docs/compatibility.md)
- [Benchmark protocol](docs/benchmark-protocol.md)
- [Open questions](docs/open-questions.md)
- [Contributing](CONTRIBUTING.md)

## Repository commands

Prerequisites: Node.js 22.12+ and pnpm 10.33.2.

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm build
```

All JavaScript/TypeScript workspace packages, including private applications, use the
`@dopejs/canvas-*` namespace. CI enforces the rule.

## Package status

All packages are private, versioned `0.0.0`, and none is a stable public contract yet.

| Package                         | Responsibility                                                    |
| ------------------------------- | ----------------------------------------------------------------- |
| `@dopejs/canvas-protocol`       | shared pre-release vocabulary                                     |
| `@dopejs/canvas-spatial`        | spatial indexes plus the naive differential oracle                |
| `@dopejs/canvas-core`           | camera, Scene Store transactions, lifecycle, visibility, budgets  |
| `@dopejs/canvas-artifact`       | revisions, interaction tree, canonical serialization              |
| `@dopejs/canvas-security`       | sanitizer, URL policy, quotas, capabilities                       |
| `@dopejs/canvas-runtime`        | runtime message protocol, epochs, capability-guarded host bridge  |
| `@dopejs/canvas-renderer`       | retained pictures, reference compositor, LOD, texture budget      |
| `@dopejs/canvas-editor`         | internal hit testing, selection model, virtual event paths        |
| `@dopejs/canvas-platform-probe` | M0 capability probes and evidence manifests (private application) |

Implementation status against the delivery plan is tracked in [the plan](docs/plan.md).
Browser-evidence gates (M0) are not exited; support for the experimental HTML-in-Canvas APIs remains
a capability, not a claim.

## License

No license has been selected yet. Until the repository owners add one, the contents are not offered
under an open-source license. License selection is a P0 release prerequisite tracked in
[the plan](docs/plan.md).
