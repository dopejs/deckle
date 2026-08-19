# Deckle

Deckle is a planned infinite-canvas runtime for large collections of AI-generated Web artifacts. An
artifact may originate as HTML, CSS, and controlled JavaScript, while the canvas owns camera
movement, spatial virtualization, live/snapshot lifecycle, interaction metadata, resource budgets,
and rendering composition.

The backend-independent engine contracts are implemented and tested: scene transactions, camera and
spatial virtualization, lifecycle and budgets, artifact revisions, sanitization, the controlled
runtime protocol, retained rendering, and internal hit testing. Streaming is a first-class property
of the node model, and supported content renders through a canvas-native profile.

Browser-evidence gates are **not** exited. Support for the experimental HTML-in-Canvas APIs is a
capability the probe detects, never a claim, and absolute performance and memory gates stay unset
until M0 measurements exist.

## Why this exists

Keeping hundreds of generated pages alive as iframes scales poorly because every iframe retains a
browsing context, DOM/CSS state, script realm, resources, and rendering state. Flattening every page
to an image saves resources but loses internal selection and event targeting. Deckle is designed
around a retained artifact model:

```text
Artifact = source + durable state + interaction tree + paint cache + optional live runtime
```

A snapshot is only a paint cache. The document and interaction model remain available for Figma-like
selection, event routing, activation, and revision-safe restoration.

Because the artifacts come from agents, they arrive incrementally. Every content kind commits at its
own boundary — a grapheme, a line, a closed markdown construct, a JSON value, a decided HTML tag —
and that boundary only moves forward, so a reader never sees an interpretation get retracted.

## Start here

- [Project website](https://canvas.dopejs.com/) — also in
  [简体中文](https://canvas.dopejs.com/zh-CN/), [繁體中文](https://canvas.dopejs.com/zh-TW/),
  [Español](https://canvas.dopejs.com/es/), [Français](https://canvas.dopejs.com/fr/),
  [Deutsch](https://canvas.dopejs.com/de/), [Русский](https://canvas.dopejs.com/ru/),
  [עברית](https://canvas.dopejs.com/he/), [العربية](https://canvas.dopejs.com/ar/),
  [日本語](https://canvas.dopejs.com/ja/), [한국어](https://canvas.dopejs.com/ko/)
- [Interactive playground](https://canvas.dopejs.com/playground/)

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
`@dopejs/deckle-*` namespace. CI enforces the rule.

## Package status

The applications stay private. Nothing is a stable public contract yet — the surface may change
before the first stable release.

Through `0.3.0` the libraries were published as `@dopejs/canvas-*`. They are being renamed to
`@dopejs/deckle-*`, first published under the new names at `0.4.0`; the `canvas-*` packages stop at
`0.3.0` and are deprecated with a pointer to their replacement. Nothing about the code changes in
that move — only the name.

| Package                         | Responsibility                                                    |
| ------------------------------- | ----------------------------------------------------------------- |
| `@dopejs/deckle-protocol`       | shared pre-release vocabulary                                     |
| `@dopejs/deckle-spatial`        | spatial indexes plus the naive differential oracle                |
| `@dopejs/deckle-core`           | camera, Scene Store transactions, lifecycle, visibility, budgets  |
| `@dopejs/deckle-artifact`       | revisions, interaction tree, canonical serialization              |
| `@dopejs/deckle-security`       | sanitizer, URL policy, quotas, capabilities                       |
| `@dopejs/deckle-runtime`        | runtime message protocol, epochs, capability-guarded host bridge  |
| `@dopejs/deckle-renderer`       | retained pictures, canvas-native content rendering, LOD, budget   |
| `@dopejs/deckle-editor`         | internal hit testing, selection model, virtual event paths        |
| `@dopejs/deckle-platform-probe` | M0 capability probes and evidence manifests (private application) |
| `@dopejs/deckle-playground`     | Storybook demos of every engine capability (private application)  |
| `@dopejs/deckle-website`        | the project site and its localized routes (private application)   |

Implementation status against the delivery plan is tracked in [the plan](docs/plan.md).
Browser-evidence gates (M0) are not exited; support for the experimental HTML-in-Canvas APIs remains
a capability, not a claim.

## The name

A deckle is the frame that bounds a sheet of handmade paper while the pulp is still settling, and
the ragged untrimmed edge it leaves is called a deckle edge. That is what this engine does: it fixes
a frame around content that has not finished arriving, and leaves the boundary visible rather than
pretending the sheet is done.

## License

[Apache-2.0](LICENSE). The patent grant matters here: the streaming boundary model and the
canvas-native rendering profile are the kind of implementation work that benefits from an explicit
grant rather than a bare permissive license.
