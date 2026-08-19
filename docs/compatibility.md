# Compatibility strategy

Deckle reports compatibility by artifact profile and platform capability tier. “HTML support”
without both qualifiers is not a valid claim.

## 1. Artifact profiles

| Profile             | Intended behavior                                           | Initial status       |
| ------------------- | ----------------------------------------------------------- | -------------------- |
| Static artifact     | validated HTML/CSS, internal editor selection, host actions | planned              |
| Controlled artifact | static profile plus capability runtime and virtual events   | planned              |
| Browser artifact    | sandboxed compatibility page with native DOM behavior       | planned escape hatch |
| ReactDOM artifact   | unchanged ReactDOM against a Web-compatible document        | research only        |

The exact tag, CSS, event, input, and API matrix is an M0/M1 deliverable. Unsupported behavior must
produce diagnostics rather than an apparently successful partial render.

## 2. Platform tiers

| Tier                  | Live representation                 | Cached representation           | Status                   |
| --------------------- | ----------------------------------- | ------------------------------- | ------------------------ |
| Native HTML-in-Canvas | layoutsubtree DOM mapped to texture | ElementImage where available    | experimental probe       |
| DOM fallback          | bounded overlay                     | backend-specific or unavailable | planned correctness path |
| Canvas-native         | compiled supported profile          | retained picture/texture        | future research          |
| Unsupported           | none                                | diagnostic placeholder          | required safety behavior |

Native HTML-in-Canvas is currently an experimental Chromium proposal, not a cross-browser baseline.
The adapter must inspect API shape and behavior, not infer support from user agent strings.

Primary references:

- [WICG HTML-in-Canvas](https://wicg.github.io/html-in-canvas/)
- [Chrome HTML-in-Canvas origin trial](https://developer.chrome.com/blog/html-in-canvas-origin-trial)
- [PixiJS v8.19 HTMLSource](https://pixijs.com/blog/june-2026)

## 3. Semantic differences by representation

| Behavior                  | Live DOM                  | Immutable snapshot + interaction tree |
| ------------------------- | ------------------------- | ------------------------------------- |
| Browser layout/paint      | native                    | frozen paint revision                 |
| Editor internal selection | supported                 | supported for retained profile        |
| Virtual host actions      | supported                 | supported if retained                 |
| Native input/IME          | supported by platform     | promote to live                       |
| Native text selection     | supported by platform     | not generally supported               |
| CSS hover/animation       | live                      | frozen or simulated profile only      |
| Arbitrary event listeners | live runtime only         | unavailable unless represented        |
| Accessibility             | native where API supports | semantic projection required          |
| Find-in-page/extensions   | native where API supports | not assumed                           |

## 4. Qualification rules

A support claim requires:

- exact browser/OS/backend versions;
- feature detection output;
- compatibility fixture results;
- performance and memory report;
- fallback result with experimental capability disabled;
- known limitations and rollback flag.

Origin-trial access, a browser flag, a mocked method, or a single demo is experimental evidence, not
general support.

## 5. Versioning

Artifact profile, persisted format, runtime messages, interaction tree, renderer contract, and
capability report are versioned independently when their compatibility needs differ. Readers reject
unsupported major versions before partial mutation. Downgrade behavior is explicit.
