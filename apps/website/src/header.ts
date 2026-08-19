import { LOCALES, localeHref, navLabel, stageLabel, type PageI18n } from "./i18n.js";

const PAGE_KEYS: readonly { page: string; key: string }[] = [
  { page: "", key: "overview" },
  { page: "docs/usage/", key: "usage" },
  { page: "docs/design/", key: "design" },
  { page: "playground/", key: "playground" },
];

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Shared site header. Navigation stays inside the active locale; the language
 * switcher links to the same page in every other locale.
 */
export function renderHeader(target: HTMLElement, context: PageI18n): void {
  const current = LOCALES.find((entry) => entry.code === context.locale) ?? LOCALES[0];

  const navLinks = PAGE_KEYS.map(({ page, key }) => {
    const active = page === context.page ? ' aria-current="page"' : "";
    return `<a class="site-nav__link" href="${escapeAttribute(localeHref(context, context.locale, page))}"${active}>${escapeText(navLabel(context, key))}</a>`;
  }).join("");

  const localeLinks = LOCALES.map((entry) => {
    const active = entry.code === context.locale ? ' aria-current="true"' : "";
    return `<li><a class="lang__option" lang="${entry.code}" dir="${entry.dir}" hreflang="${entry.code}" href="${escapeAttribute(localeHref(context, entry.code))}"${active}>${escapeText(entry.name)}</a></li>`;
  }).join("");

  target.innerHTML = `
    <header class="site-header">
      <a class="site-brand" href="${escapeAttribute(localeHref(context, context.locale, ""))}">
        <!-- Frames on an unbounded surface: no outer border, because the canvas
             has no edge. Two have settled; the third is still arriving, so it
             carries a deckle edge — the ragged untrimmed boundary of a sheet
             that has not been cut yet. -->
        <svg class="site-brand__glyph" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="2.6" y="3.6" width="7.4" height="17.6" rx="1.1" fill="currentColor"/>
          <rect x="13.2" y="3.6" width="8.2" height="6.2" rx="1.1" fill="currentColor"/>
          <path d="M13.2 12.6 H21.2 L20.2 14.4 L21.4 16.2 L20.1 18 L21.3 19.8 L20.6 21.2 H13.2 Z" fill="currentColor" opacity="0.4"/>
        </svg>
        <span class="site-brand__name" dir="ltr">Deckle</span>
        <span class="site-brand__stage">${escapeText(stageLabel(context))}</span>
      </a>
      <nav class="site-nav" aria-label="${escapeAttribute(navLabel(context, "overview"))}">
        ${navLinks}
        <a class="site-nav__link" href="https://github.com/dopejs/deckle" target="_blank" rel="noreferrer">${escapeText(navLabel(context, "github"))}</a>
        <details class="lang">
          <summary class="lang__summary" title="${escapeAttribute(navLabel(context, "language"))}">
            <svg class="lang__glyph" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.3"/>
              <path d="M1.5 8h13M8 1.5c3.5 3.6 3.5 9.4 0 13M8 1.5C4.5 5.1 4.5 10.9 8 14.5" fill="none" stroke="currentColor" stroke-width="1.3"/>
            </svg>
            <span class="lang__current">${escapeText(current?.name ?? "English")}</span>
          </summary>
          <ul class="lang__menu">${localeLinks}</ul>
        </details>
      </nav>
    </header>
  `;

  // Close the language menu on outside click and on Escape.
  const details = target.querySelector("details.lang");
  if (details instanceof HTMLDetailsElement) {
    document.addEventListener("click", (event) => {
      if (details.open && event.target instanceof Node && !details.contains(event.target)) {
        details.open = false;
      }
    });
    details.addEventListener("keydown", (event) => {
      if (event.key === "Escape") details.open = false;
    });
  }
}
