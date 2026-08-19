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
        <!-- Three artifact panels; the stepped lower panel marks a boundary still arriving. -->
        <svg class="site-brand__glyph" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="2" y="2" width="7" height="20" rx="1" fill="currentColor"/>
          <rect x="12" y="2" width="10" height="8.5" rx="1" fill="var(--ink)" opacity="0.72"/>
          <path d="M12 12h10v2.5h-2.5V17H22v2.5h-2.5V22H12z" fill="currentColor"/>
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
