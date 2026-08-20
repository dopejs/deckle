# Deckle website

The public website follows the same architecture as the Pingo website: a Vite-built React
application with build-time rendering and client hydration.

- `content.mjs` owns canonical route resolution, Markdown rendering, and the translation payload for
  each page.
- `src/ssr.tsx` renders complete English first paint for every route during the website build;
  `src/main.tsx` hydrates it and selects the preferred language.
- Every language shares the same public URL. Localized URL prefixes from the previous site remain as
  compatibility redirects, not duplicate pages.
- Language selection uses the same `dopejs.locale` local-storage key and `dopejs_locale` cookie as
  Pingo. On `*.dopejs.com`, the cookie is scoped to `Domain=dopejs.com`, allowing the two sites to
  share a preference.
- The home-page visual content remains in `content/home.html`; Usage, Design, Plan, Security,
  Compatibility, and Benchmark Protocol are rendered from the repository's Markdown sources at build
  time.
- `/playground/` is a production-facing demo gallery. Its infinite-canvas, retained-interaction, and
  safe-streaming scenes call the real workspace packages directly; Storybook remains an internal
  development surface and is not included in the public site artifact.

Run `pnpm --filter @dopejs/deckle-website dev` for local development and
`pnpm --filter @dopejs/deckle-website build` for the static output in `dist`.

## Failure and rollback boundaries

GitHub Pages receives static website files only. Reverting the demo-gallery change restores the
Storybook iframe deployment; no persisted artifact or engine state requires migration. The shared
cookie contains only a supported language tag and remains valid across either website
implementation.
