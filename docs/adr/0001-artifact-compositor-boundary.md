# ADR 0001: Build an artifact compositor, not a general browser

- Status: accepted for initial probes
- Date: 2026-08-16
- Owners: repository owners

## Context

The product must place hundreds of AI-generated HTML-like pages in an infinite canvas without
retaining one full iframe per logical artifact. Full Web-platform compatibility would require a
browser-scale parser, CSS engine, DOM, event loop, Web APIs, input, accessibility, security, and
compatibility program before validating the canvas lifecycle hypothesis.

## Decision

dope-canvas initially owns artifact ingestion, world geometry, virtualization, lifecycle, retained
interaction metadata, resource budgets, and composition. It defines explicit static, controlled, and
browser artifact profiles. It does not initially promise arbitrary HTML/CSS/JS or ReactDOM
compatibility.

## Alternatives

- **Full browser engine:** maximum theoretical compatibility, unacceptable initial scope and risk.
- **Permanent iframe per artifact:** simple semantics, fails the target memory/lifecycle model.
- **Image-only whiteboard:** efficient paint, loses required internal selection and interaction.

## Evidence

M0 will measure identical artifact corpora across DOM, Shadow DOM, iframe, live texture, snapshot,
and controlled-runtime representations.

## Consequences

Compatibility is described by profiles. LLM generation must target a validated profile. Browser
artifacts remain an escape hatch with explicit budget and limitations.

## Failure modes

The controlled profile may be too restrictive for useful generated artifacts, or profile boundaries
may confuse users. Compatibility diagnostics and corpus coverage are product requirements.

## Rollback

Profiles are additive and versioned. Evidence may justify expanding compatibility or selecting an
existing browser embedding platform without changing persisted artifact identity.

## Verification

M0 corpus coverage, runtime economics, and user workflow probes determine the first supported
profile.
