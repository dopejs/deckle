import { marked } from "marked";
import { renderHeader } from "./header.js";
import { noticeLabel, readPageI18n } from "./i18n.js";

/**
 * Render a repository markdown document as an in-site page. The markdown files
 * under docs/ stay the source of truth; this only handles presentation.
 *
 * The documents themselves are English only, so the article keeps lang="en"
 * and non-English pages show a localized notice above it. Relative links
 * between docs are rewritten to their in-site routes when a route exists (and
 * stay inside the active locale), and to GitHub otherwise.
 */
const DOC_ROUTES: Record<string, string> = {
  "usage.md": "docs/usage/",
  "design.md": "docs/design/",
};

const GITHUB_DOCS = "https://github.com/dopejs/deckle/blob/main/docs/";

export async function renderDocPage(markdown: string): Promise<void> {
  const context = readPageI18n();

  const header = document.getElementById("header");
  if (header) renderHeader(header, context);

  const notice = document.getElementById("doc-notice");
  if (notice && context.locale !== "en") {
    notice.textContent = noticeLabel(context);
    notice.hidden = false;
  }

  const article = document.getElementById("doc");
  if (!article) return;
  article.innerHTML = await marked.parse(markdown, { async: true });

  for (const anchor of article.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const href = anchor.getAttribute("href") ?? "";
    if (/^(https?:)?\/\//.test(href) || href.startsWith("#")) continue;
    const clean = href.replace(/^\.\//, "");
    const route = DOC_ROUTES[clean];
    if (route) {
      // Sibling doc: stay on the same page path, inside the same locale.
      anchor.href = `../../${route.replace("docs/", "")}`;
    } else {
      anchor.href = `${GITHUB_DOCS}${clean}`;
      anchor.target = "_blank";
      anchor.rel = "noreferrer";
    }
  }
}
