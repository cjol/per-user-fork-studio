/** A commit shown in the overlay's history panel. */
export interface LogEntry {
  oid: string;
  short: string;
  message: string;
}

/** State snapshot returned by the host API and rendered by the overlay. */
export interface AppState {
  user: string;
  repo: string;
  loggedIn: boolean;
  pushedToFork: boolean;
  log: LogEntry[];
  baseAhead: boolean;
  error?: string;
  note?: string;
}

export type ModelChoice = "fast" | "capable";

/** An authenticated visitor. `user` names the fork DO and Artifacts repo. */
export interface AuthSession {
  /** Stable identifier for this visitor (fork + repo names derive from it). */
  user: string;
  /** Admins edit the base app itself instead of a personal fork. */
  isAdmin: boolean;
}

/**
 * Pluggable identity for the host worker.
 *
 * The default (`cookieAuth()`) reproduces the prototype's behavior: a
 * self-chosen name in a cookie, with a fixed admin name. Production apps can
 * swap in Cloudflare Access, a JWT check, or their own session store — the
 * harness only needs a stable `user` string and an `isAdmin` bit.
 */
export interface AuthProvider {
  /** Identify the visitor, or return null for anonymous (serves the base app). */
  identify(
    request: Request,
    env: Cloudflare.Env
  ): Promise<AuthSession | null> | AuthSession | null;
  /**
   * Handle provider-owned routes (login, logout, OAuth callbacks…).
   * Return null to fall through to the app.
   */
  handleRequest?(
    request: Request,
    env: Cloudflare.Env
  ): Promise<Response | null> | Response | null;
  /** HTML for the overlay's sign-in panel shown to anonymous visitors. */
  loginPanelHtml?(): string;
}

/** A fork's code, built and ready for the Worker Loader. */
export interface BuiltApp {
  /** Entry module name passed to the Worker Loader. */
  mainModule: string;
  /** Module map passed to the Worker Loader. */
  modules: Record<string, WorkerLoaderModule | string>;
  /** Serve a static asset for this request, or null if it isn't one. */
  serveAsset(request: Request): Promise<Response | null>;
}

/**
 * Pluggable build step that turns a fork's files into loadable Worker code.
 *
 * The default (`workerBundler()`) wraps `@cloudflare/worker-bundler`'s fast
 * dependency-free transform, which is what keeps per-fork rebuilds cheap
 * inside a Durable Object isolate. A future bundler could support npm
 * dependencies (e.g. esbuild-wasm with a module cache) behind this same
 * interface — `createForkableWorker` only needs `build()` to return
 * loader-ready modules and an asset handler.
 */
export interface AppBundler {
  build(
    files: Record<string, string>,
    ctx: { entry: string }
  ): Promise<BuiltApp>;
}

/** RPC surface of the UserApp Durable Object, as called by the host router. */
export interface UserAppStub {
  appState(): Promise<AppState>;
  mergeBase(): Promise<AppState>;
  streamAgentEdit(prompt: string, model: ModelChoice): Promise<ReadableStream>;
  revertCommit(oid: string): Promise<AppState>;
  ensureBaseExists(): Promise<string>;
  registerFork(name: string): Promise<void>;
  resetForkDOs(): Promise<number>;
  resetSelf(): Promise<void>;
  resetBase(): Promise<void>;
  serve(
    reqUrl: string,
    method: string,
    asAdmin?: boolean,
    body?: ArrayBuffer
  ): Promise<Response>;
}
