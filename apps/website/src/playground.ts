import { renderHeader } from "./header.js";

const header = document.getElementById("header");
if (header) renderHeader(header, { root: "../", active: "playground" });

/**
 * Deep-linkable playground: the Storybook query string (?path=/story/...)
 * lives on the site URL. On load it is forwarded to the embedded Storybook;
 * afterwards story navigation inside the same-origin iframe is mirrored back
 * with replaceState, so the address bar is always shareable.
 */
const frame = document.getElementById("storybook-frame");
if (frame instanceof HTMLIFrameElement) {
  frame.src = `../storybook/${window.location.search}`;

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
