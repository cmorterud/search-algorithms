import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  base: "/search-algorithms/",
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        recording: resolve(import.meta.dirname, "recording/index.html"),
      },
    },
  },
});
