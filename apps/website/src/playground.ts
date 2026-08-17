import { renderHeader } from "./header.js";
import { readPageI18n } from "./i18n.js";

const context = readPageI18n();

const header = document.getElementById("header");
if (header) renderHeader(header, context);

/**
 * Deep-linkable playground: the Storybook query string (?path=/story/...)
 * lives on the site URL. On load it is forwarded to the embedded Storybook;
 * afterwards story navigation inside the same-origin iframe is mirrored back
 * with replaceState, so the address bar is always shareable.
 *
 * Storybook itself is served once at the site root, shared by every locale.
 */
const frame = document.getElementById("storybook-frame");
if (frame instanceof HTMLIFrameElement) {
  frame.src = `${context.root}storybook/${window.location.search}`;

  let mirrored = window.location.search;
  window.setInterval(() => {
    let search: string;
    try {
      search = frame.contentWindow?.location.search ?? "";
    } catch {
      return; // cross-origin only if misdeployed; never break the page
    }
    if (search !== mirrored) {
      mirrored = search;
      history.replaceState(null, "", `${window.location.pathname}${search}`);
    }
  }, 250);
}
