import { defineConfig } from "vite";

export default defineConfig({
  // GitHub Pages serves the site under https://<user>.github.io/<repo>/,
  // so assets must resolve relative to that sub-path.
  base: "/test/",
  server: {
    host: true,
    port: 5173,
  },
});
