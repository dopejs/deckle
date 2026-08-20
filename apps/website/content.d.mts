import type { PageSummary, SiteDocumentPayload, SitePayload } from "./src/types";

export interface SiteContent {
  readonly pages: readonly { readonly route: string; readonly href: string }[];
  readonly searchIndex: readonly PageSummary[];
  payloadForPage(page: unknown, localePath?: string): SitePayload;
  documentForRoute(route: string): SiteDocumentPayload;
  payloadForPath(pathname: string): SiteDocumentPayload;
}

export function loadSiteContent(): Promise<SiteContent>;
export function applyMessages(html: string, messages: Readonly<Record<string, string>>): string;
