// Runtime entry: everything the generated host worker entry (or a hand-written
// one) needs. This module runs inside workerd, not node — the Vite plugin
// lives at the package root instead.

import { resolveConfig, type RuntimeOverrides } from "./config.js";
import {
  createForkableWorkerFromConfig,
  type ForkableWorker
} from "./user-app.js";
import type { ForkableAppManifest } from "../shared/manifest.js";

/**
 * Turn a manifest (usually the `virtual:forkable-worker/app` module emitted by
 * the Vite plugin) into the host worker's exports:
 *
 * ```ts
 * const forkable = createForkableWorker(manifest, { auth: myAuth });
 * export class UserApp extends forkable.UserApp {}
 * export default forkable.handler;
 * ```
 */
export function createForkableWorker(
  manifest: ForkableAppManifest,
  overrides: RuntimeOverrides = {}
): ForkableWorker {
  return createForkableWorkerFromConfig(resolveConfig(manifest, overrides));
}

export { cookieAuth, type CookieAuthOptions } from "./auth.js";
export { workerBundler } from "./bundler.js";
export {
  resolveConfig,
  type ResolvedForkableConfig,
  type RuntimeOverrides
} from "./config.js";
export type { ForkableWorker, UserAppClass } from "./user-app.js";
export type {
  AppBundler,
  AppState,
  AuthProvider,
  AuthSession,
  BuiltApp,
  LogEntry,
  ModelChoice,
  UserAppStub
} from "./types.js";
export type {
  BindingNames,
  BuildOptions,
  ForkableAppManifest
} from "../shared/manifest.js";
