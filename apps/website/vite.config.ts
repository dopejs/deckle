import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/dope-canvas/",
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        playground: resolve(import.meta.dirname, "playground/index.html"),
      },
    },
  },
});
