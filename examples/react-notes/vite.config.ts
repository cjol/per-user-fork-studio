import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { forkableWorker } from "vite-plugin-forkable-worker";

export default defineConfig({
  plugins: [
    forkableWorker({
      appDir: "app",
      entry: "src/index.ts",
      name: "react-notes",
      // Forks rebuild with real npm deps (react, react-dom fetched from the
      // registry) and a browser bundle: src/client.tsx is served at /client.js.
      build: {
        client: "src/client.tsx",
        jsx: "automatic",
        jsxImportSource: "react"
      }
    }),
    cloudflare()
  ]
});
