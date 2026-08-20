import { useEffect, useRef, useState, type ReactNode } from "react";

import { mountHeroCanvas } from "./hero-canvas";
import { writeLanguagePreference } from "./language-preference";
import { SITE_LOCALES, localeForPath, pageHref } from "./locales";
import { SearchDialog } from "./SearchDialog";
import type { PageLink, SiteDocumentPayload, SiteMessages, SitePage, SitePayload } from "./types";

interface AppProps {
  readonly siteDocument: SiteDocumentPayload;
  readonly initialLocalePath: string;
}

interface NavItem {
  readonly text: string;
  readonly route: string;
}

interface NavSection {
  readonly text: string;
  readonly items: readonly NavItem[];
}

function message(messages: SiteMessages, key: string, fallback: string): string {
  return messages[key] ?? fallback;
}

function navItems(messages: SiteMessages): readonly NavItem[] {
  return [
    { text: message(messages, "nav.overview", "Overview"), route: "/" },
    { text: message(messages, "nav.usage", "Usage"), route: "/docs/usage" },
    { text: message(messages, "nav.design", "Design"), route: "/docs/design" },
    { text: message(messages, "nav.playground", "Playground"), route: "/playground" },
  ];
}

function sidebarSections(messages: SiteMessages): readonly NavSection[] {
  return [
    {
      text: message(messages, "ui.sectionStart", "Start"),
      items: [{ text: message(messages, "nav.usage", "Usage"), route: "/docs/usage" }],
    },
    {
      text: message(messages, "ui.sectionEngineering", "Engineering"),
      items: [
        { text: message(messages, "nav.design", "Design"), route: "/docs/design" },
        { text: message(messages, "ui.plan", "Delivery plan"), route: "/docs/plan" },
        { text: message(messages, "ui.security", "Security"), route: "/docs/security" },
        {
          text: message(messages, "ui.compatibility", "Compatibility"),
          route: "/docs/compatibility",
        },
        {
          text: message(messages, "ui.benchmarks", "Benchmarks"),
          route: "/docs/benchmark-protocol",
        },
      ],
    },
  ];
}

function DeckleMark({ className }: { readonly className: string }): ReactNode {
  return (
    <svg
      className={`deckle-mark ${className}`}
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
    >
      <rect className="deckle-mark__accent" x="4" y="4" width="13" height="40" rx="1.5" />
      <rect className="deckle-mark__ink" x="23" y="4" width="21" height="17" rx="1.5" />
      <path className="deckle-mark__accent" d="M23 25h21v5h-5v5h5v5h-5v4H23z" />
    </svg>
  );
}

function SiteHeader({
  page,
  onLocaleChange,
}: {
  readonly page: SitePage;
  onLocaleChange: (path: string) => void;
}): ReactNode {
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const { messages } = page;

  useEffect(() => {
    const openSearch = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", openSearch);
    return () => {
      window.removeEventListener("keydown", openSearch);
    };
  }, []);

  const toggleTheme = (): void => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("deckle-theme", next);
  };

  return (
    <>
      <header className="site-header">
        <a className="site-brand" href="/" aria-label="Deckle home">
          <DeckleMark className="site-brand__glyph" />
          <span className="site-brand__name">Deckle</span>
          <span className="site-brand__stage">
            {message(messages, "brand.stage", "pre-release")}
          </span>
        </a>
        <nav className={menuOpen ? "site-nav site-nav--open" : "site-nav"} aria-label="Primary">
          {navItems(messages).map((item) => (
            <a
              key={item.route}
              className="site-nav__link"
              href={pageHref(item.route)}
              aria-current={page.route === item.route ? "page" : undefined}
            >
              {item.text}
            </a>
          ))}
        </nav>
        <div className="header-tools">
          <button
            className="search-trigger"
            type="button"
            onClick={() => {
              setSearchOpen(true);
            }}
          >
            <span aria-hidden="true">⌕</span>
            <span>{message(messages, "ui.search", "Search")}</span>
            <kbd>⌘ K</kbd>
          </button>
          <select
            className="locale-select"
            aria-label={message(messages, "nav.language", "Language")}
            value={page.localePath}
            onChange={(event) => {
              onLocaleChange(event.currentTarget.value);
            }}
          >
            {SITE_LOCALES.map((locale) => (
              <option key={locale.path} value={locale.path}>
                {locale.label}
              </option>
            ))}
          </select>
          <button
            className="icon-button"
            type="button"
            title={message(messages, "ui.appearance", "Appearance")}
            aria-label={message(messages, "ui.appearance", "Appearance")}
            onClick={toggleTheme}
          >
            ◐
          </button>
          <a
            className="icon-button github-link"
            href="https://github.com/dopejs/deckle"
            aria-label="GitHub"
          >
            GH
          </a>
          <button
            className="mobile-menu-button"
            type="button"
            aria-expanded={menuOpen}
            aria-label={message(messages, "ui.menu", "Menu")}
            onClick={() => {
              setMenuOpen((value) => !value);
            }}
          >
            {menuOpen ? "×" : "☰"}
          </button>
        </div>
      </header>
      <SearchDialog
        localePath={page.localePath}
        messages={messages}
        open={searchOpen}
        onClose={() => {
          setSearchOpen(false);
        }}
      />
    </>
  );
}

function Sidebar({ page }: { readonly page: SitePage }): ReactNode {
  return (
    <aside className="sidebar" aria-label="Documentation">
      {sidebarSections(page.messages).map((section) => (
        <section key={section.text}>
          <h2>{section.text}</h2>
          {section.items.map((item) => (
            <a
              key={item.route}
              href={pageHref(item.route)}
              aria-current={page.route === item.route ? "page" : undefined}
            >
              {item.text}
            </a>
          ))}
        </section>
      ))}
    </aside>
  );
}

function PageOutline({ page }: { readonly page: SitePage }): ReactNode {
  if (page.tableOfContents.length === 0) return null;
  return (
    <aside className="page-outline" aria-label="On this page">
      <h2>{message(page.messages, "ui.outline", "On this page")}</h2>
      {page.tableOfContents.map((item) => (
        <a key={item.id} className={`outline-level-${String(item.level)}`} href={`#${item.id}`}>
          {item.title}
        </a>
      ))}
    </aside>
  );
}

function Pagination({
  previous,
  next,
  messages,
}: SitePayload & { readonly messages: SiteMessages }): ReactNode {
  if (previous === undefined && next === undefined) return null;
  const item = (link: PageLink | undefined, direction: "previous" | "next"): ReactNode =>
    link === undefined ? (
      <span />
    ) : (
      <a className={`page-link page-link--${direction}`} href={link.href}>
        <small>
          {direction === "previous"
            ? message(messages, "ui.previous", "Previous page")
            : message(messages, "ui.next", "Next page")}
        </small>
        <strong>{link.title}</strong>
      </a>
    );
  return (
    <nav className="pagination" aria-label="Pagination">
      {item(previous, "previous")}
      {item(next, "next")}
    </nav>
  );
}

function HomePage({ page }: { readonly page: SitePage }): ReactNode {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const canvas = root.current?.querySelector<HTMLCanvasElement>("#hero-canvas");
    if (canvas === null || canvas === undefined) return;
    return mountHeroCanvas(canvas, root.current?.querySelector("#hero-coord") ?? null);
  }, [page.html]);
  return (
    <div ref={root} className="home-content" dangerouslySetInnerHTML={{ __html: page.html }} />
  );
}

function PlaygroundFrame({ title }: { readonly title: string }): ReactNode {
  const frame = useRef<HTMLIFrameElement>(null);
  const [source] = useState(() =>
    typeof location === "undefined" ? "/storybook/" : `/storybook/${location.search}`,
  );
  useEffect(() => {
    let mirrored = location.search;
    const interval = window.setInterval(() => {
      try {
        const search = frame.current?.contentWindow?.location.search ?? "";
        if (search === mirrored) return;
        mirrored = search;
        history.replaceState(null, "", `${location.pathname}${search}`);
      } catch {
        // A misconfigured cross-origin frame must not break the site shell.
      }
    }, 250);
    return () => {
      window.clearInterval(interval);
    };
  }, []);
  return (
    <main className="playground-shell">
      <iframe ref={frame} className="playground-shell__frame" src={source} title={title} />
    </main>
  );
}

function SiteFooter({ page }: { readonly page: SitePage }): ReactNode {
  return (
    <footer className="site-footer">
      <DeckleMark className="site-footer__mark" />
      <span>{message(page.messages, "footer.text", "Deckle · pre-release ·")}</span>
      <a href="https://github.com/dopejs/deckle">GitHub</a>
      <span>© 2026 Deckle contributors</span>
    </footer>
  );
}

export function App({ siteDocument, initialLocalePath }: AppProps): ReactNode {
  const [localePath, setLocalePath] = useState(initialLocalePath);
  const payload =
    siteDocument.translations[localePath] ??
    siteDocument.translations.en ??
    Object.values(siteDocument.translations)[0]!;
  const { page } = payload;

  useEffect(() => {
    document.title = page.title;
    document
      .querySelector<HTMLMetaElement>('meta[name="description"]')
      ?.setAttribute("content", page.description);
  }, [page.description, page.title]);

  const changeLocale = (path: string): void => {
    const next = localeForPath(path).path;
    const locale = localeForPath(next);
    writeLanguagePreference(next);
    setLocalePath(next);
    document.documentElement.lang = locale.lang;
    document.documentElement.dir = locale.dir;
  };

  let content: ReactNode;
  if (page.layout === "home") {
    content = <HomePage page={page} />;
  } else if (page.layout === "playground") {
    content = <PlaygroundFrame title={page.title} />;
  } else {
    content = (
      <div className="docs-grid">
        <Sidebar page={page} />
        <main className="doc-main">
          {page.notice !== undefined && <p className="doc-notice">{page.notice}</p>}
          <article
            className="doc-content"
            lang={page.contentLanguage}
            dir="ltr"
            dangerouslySetInnerHTML={{ __html: page.html }}
          />
          <p className="last-updated">
            {message(page.messages, "ui.lastUpdated", "Last updated")}:{" "}
            <time dateTime={page.lastUpdated}>{page.lastUpdated.slice(0, 10)}</time>
          </p>
          <Pagination {...payload} messages={page.messages} />
        </main>
        <PageOutline page={page} />
      </div>
    );
  }

  const special = page.layout === "playground";
  return (
    <div className={special ? "site site--full" : "site"} dir={localeForPath(localePath).dir}>
      <SiteHeader page={page} onLocaleChange={changeLocale} />
      {content}
      {!special && <SiteFooter page={page} />}
    </div>
  );
}
