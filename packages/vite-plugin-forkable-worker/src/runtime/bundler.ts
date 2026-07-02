import {
  createApp,
  handleAssetRequest,
  createMemoryStorage
} from "@cloudflare/worker-bundler";
import type { AppBundler, BuiltApp } from "./types.js";

/**
 * Default bundler: `@cloudflare/worker-bundler`'s fast transform. With no
 * client entry and no npm dependencies this is a sucrase pass (no esbuild
 * bundling), which keeps the host Durable Object isolate's memory use low —
 * the reason the built-in agent prompt forbids adding dependencies.
 *
 * A dependency-aware bundler is the main expansion point here: implement
 * `AppBundler` with esbuild + a module cache and pass it to
 * `createForkableWorker({ bundler })` (or the plugin's `bundler` option).
 */
export function workerBundler(): AppBundler {
  return {
    async build(files, { entry }): Promise<BuiltApp> {
      const built = await createApp({ files, server: entry });
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
