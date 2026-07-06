import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { forkableWorker } from "vite-plugin-forkable-worker";

export default defineConfig({
  plugins: [
    // Everything under app/ becomes the seed repo each visitor forks; the
    // host worker entry is generated at .forkable/entry.ts (see wrangler.jsonc).
    forkableWorker({
      appDir: "app",
      entry: "src/index.ts",
      name: "todo-forkable"
    }),
    cloudflare()
  ]
});
