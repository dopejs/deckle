/**
 * Shared site header, used by every page including the playground shell so
 * the Storybook sub-route lives under the same chrome. `root` is the relative
 * prefix back to the site root ("./" on the landing page, "../" one level
 * down).
 */
export interface HeaderOptions {
  readonly root: string;
  readonly active: "overview" | "playground";
}

export function renderHeader(target: HTMLElement, options: HeaderOptions): void {
  const { root, active } = options;
  const link = (href: string, label: string, key: string, external = false): string => {
    const current = key === active ? ' aria-current="page"' : "";
    const externalAttrs = external ? ' target="_blank" rel="noreferrer"' : "";
    return `<a class="site-nav__link" href="${href}"${current}${externalAttrs}>${label}</a>`;
  };

  target.innerHTML = `
    <header class="site-header">
      <a class="site-brand" href="${root}">
        <svg class="site-brand__glyph" viewBox="0 0 20 20" aria-hidden="true">
          <rect x="1.5" y="1.5" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.5"/>
          <rect x="0" y="0" width="3" height="3" fill="currentColor"/>
          <rect x="17" y="0" width="3" height="3" fill="currentColor"/>
          <rect x="0" y="17" width="3" height="3" fill="currentColor"/>
          <rect x="17" y="17" width="3" height="3" fill="currentColor"/>
        </svg>
        <span class="site-brand__name">dope-canvas</span>
        <span class="site-brand__stage">pre-release</span>
      </a>
      <nav class="site-nav" aria-label="Site">
        ${link(root, "Overview", "overview")}
        ${link(`${root}playground/`, "Playground", "playground")}
        ${link("https://github.com/dopejs/dope-canvas/blob/main/docs/design.md", "Design doc", "design", true)}
        ${link("https://github.com/dopejs/dope-canvas", "GitHub", "github", true)}
      </nav>
    </header>
  `;
}
