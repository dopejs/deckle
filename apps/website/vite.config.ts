import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  // Relative base: the site is served from the custom domain root
  // (deckle.dopejs.com) and must also work under a path prefix.
  base: "./",
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        playground: resolve(import.meta.dirname, "playground/index.html"),
        usage: resolve(import.meta.dirname, "docs/usage/index.html"),
        design: resolve(import.meta.dirname, "docs/design/index.html"),
      },
    },
  },
});
