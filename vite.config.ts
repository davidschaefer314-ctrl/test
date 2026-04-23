import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves the site under https://<user>.github.io/<repo>/,
  // so assets must resolve relative to that sub-path.
  base: "/test/",
  server: {
    host: true,
    port: 5173,
  },
});
