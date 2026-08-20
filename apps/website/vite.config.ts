import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vite";

const PAGE_ENDPOINT = "/__deckle/site-page";
const SEARCH_ENDPOINT = "/__deckle/search-index.json";

interface DevelopmentContent {
  payloadForPath(pathname: string): unknown;
  readonly searchIndex: unknown;
}

interface JsonResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(value: string): void;
}

function developmentContent(): Plugin {
  let contentPromise: Promise<DevelopmentContent> | undefined;
  const content = async (): Promise<DevelopmentContent> => {
    contentPromise ??= import("./content.mjs").then(
      async ({ loadSiteContent }) => (await loadSiteContent()) as DevelopmentContent,
    );
    return contentPromise;
  };

  return {
    name: "deckle-site-content",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const requestUrl = (request as { readonly url?: string }).url;
        const url = new URL(requestUrl ?? "/", "http://deckle.local");
        const json = (value: unknown): void => {
          const result = response as unknown as JsonResponse;
          result.statusCode = 200;
          result.setHeader("Content-Type", "application/json; charset=utf-8");
          result.setHeader("Cache-Control", "no-store");
          result.end(JSON.stringify(value));
        };
        if (url.pathname === PAGE_ENDPOINT) {
          void content()
            .then((site) => {
              json(site.payloadForPath(url.searchParams.get("path") ?? "/"));
            })
            .catch(next);
          return;
        }
        if (url.pathname === SEARCH_ENDPOINT) {
          void content()
            .then((site) => {
              json(site.searchIndex);
            })
            .catch(next);
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  root: new URL(".", import.meta.url).pathname,
  plugins: [react(), developmentContent()],
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
});
