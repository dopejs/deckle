export type PageLayout = "doc" | "home" | "playground";

export type SiteMessages = Readonly<Record<string, string>>;

export interface TableOfContentsItem {
  readonly id: string;
  readonly level: 2 | 3;
  readonly title: string;
}

export interface SitePage {
  readonly route: string;
  readonly href: string;
  readonly sourcePath?: string;
  readonly layout: PageLayout;
  readonly localePath: string;
  readonly title: string;
  readonly description: string;
  readonly html: string;
  readonly contentLanguage: string;
  readonly messages: SiteMessages;
  readonly notice?: string;
  readonly tableOfContents: readonly TableOfContentsItem[];
  readonly lastUpdated: string;
}

export interface PageSummary {
  readonly route: string;
  readonly href: string;
  readonly title: string;
  readonly description: string;
  readonly localePath: string;
  readonly headings: readonly string[];
  readonly text: string;
}

export interface PageLink {
  readonly href: string;
  readonly title: string;
}

export interface SitePayload {
  readonly page: SitePage;
  readonly previous?: PageLink;
  readonly next?: PageLink;
}

/** Every translation for one canonical, language-neutral URL. */
export interface SiteDocumentPayload {
  readonly translations: Readonly<Record<string, SitePayload>>;
}
