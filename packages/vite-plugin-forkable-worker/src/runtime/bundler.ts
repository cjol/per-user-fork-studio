import { createApp, handleAssetRequest, createMemoryStorage } from "@cloudflare/worker-bundler";
import type { BuildOptions } from "../shared/manifest.js";
import type { AppBundler, BuiltApp } from "./types.js";

/**
 * Default bundler, wrapping `@cloudflare/worker-bundler`'s `createApp`:
 *
 * - npm dependencies declared in the fork's package.json are fetched from the
 *   registry and bundled (worker-bundler installs a flat node_modules)
 * - `client` entries are bundled for the browser and served as assets
 *   (`src/client.tsx` → `/client.js`), with `jsx`/`jsxImportSource` support
 * - seed files under `assetsDir` (default "public/") are served as static
 *   assets; everything else is server source
 *
 * With no client entry and no dependencies this stays the fast sucrase
 * transform. Dependency installs run inside the host Durable Object isolate
 * on every cold rebuild, which costs memory and startup latency — for heavy
 * apps, a custom `AppBundler` can persist installs with worker-bundler's
 * `DurableObjectKVFileSystem` so packages are fetched once, not per rebuild.
 */
export function workerBundler(options: BuildOptions = {}): AppBundler {
  const assetsPrefix = (options.assetsDir ?? "public").replace(/\/+$/, "") + "/";
  return {
    async build(files, { entry }): Promise<BuiltApp> {
      const source: Record<string, string> = {};
      const assets: Record<string, string> = {};
      for (const [path, content] of Object.entries(files)) {
        if (path.startsWith(assetsPrefix)) {
          assets["/" + path.slice(assetsPrefix.length)] = content;
        } else {
          source[path] = content;
        }
      }
      const built = await createApp({
        files: source,
        server: entry,
        client: options.client,
        jsx: options.jsx,
        jsxImportSource: options.jsxImportSource,
        assets: Object.keys(assets).length ? assets : undefined
      });
      const storage = createMemoryStorage(built.assets ?? {});
      return {
        mainModule: built.mainModule,
        modules: built.modules,
        async serveAsset(request) {
          const res = await handleAssetRequest(
            request,
            built.assetManifest,
            storage,
            built.assetConfig
          );
          return res ?? null;
        }
      };
    }
  };
}
