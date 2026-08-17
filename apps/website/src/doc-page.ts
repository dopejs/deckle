import { marked } from "marked";
import { renderHeader, type HeaderOptions } from "./header.js";

/**
 * Render a repository markdown document as an in-site page. The markdown files
 * under docs/ stay the source of truth; this only handles presentation.
 * Relative links between docs are rewritten to their in-site routes when a
 * route exists, and to GitHub otherwise.
 */
const DOC_ROUTES: Record<string, string> = {
  "usage.md": "docs/usage/",
  "design.md": "docs/design/",
};

const GITHUB_DOCS = "https://github.com/dopejs/dope-canvas/blob/main/docs/";

export async function renderDocPage(
  markdown: string,
  options: HeaderOptions & { title: string },
): Promise<void> {
  const header = document.getElementById("header");
  if (header) renderHeader(header, options);

  const article = document.getElementById("doc");
  if (!article) return;

  const html = await marked.parse(markdown, { async: true });
  article.innerHTML = html;

  for (const anchor of article.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const href = anchor.getAttribute("href") ?? "";
    if (/^(https?:)?\/\//.test(href) || href.startsWith("#")) continue;
    const clean = href.replace(/^\.\//, "");
    const route = DOC_ROUTES[clean];
    anchor.href = route ? `${options.root}${route}` : `${GITHUB_DOCS}${clean}`;
  }

  document.title = `${options.title} — dope-canvas`;
}
