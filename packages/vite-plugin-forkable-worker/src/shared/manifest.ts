/** Names of the Worker bindings the forkable harness needs. */
export interface BindingNames {
  /** Artifacts binding used for the base repo + per-user forks. */
  artifacts: string;
  /** Workers AI binding used to run the edit agent's model. */
  ai: string;
  /** Durable Object namespace binding for the `UserApp` host class. */
  userApp: string;
  /** Worker Loader binding used to run each fork's built code. */
  loader: string;
}

/** How each fork's files are built (passed to the default worker-bundler). */
export interface BuildOptions {
  /**
   * Client entry point(s) bundled for the browser. `src/client.tsx` is served
   * at `/client.js` (the bundler strips `src/` and rewrites the extension).
   */
  client?: string | string[];
  /** JSX mode (e.g. "automatic" to skip explicit React imports). */
  jsx?: "transform" | "preserve" | "automatic";
  /** JSX runtime import source (e.g. "react", "preact"). */
  jsxImportSource?: string;
  /** Seed directory served as static assets. Default "public". */
  assetsDir?: string;
  /**
   * Whether the edit agent may manage npm dependencies in package.json
   * (worker-bundler installs them at build time). Default: true when the
   * seed package.json declares dependencies, else false.
   */
  allowDependencies?: boolean;
}

/**
 * Everything the Vite plugin embeds into the host worker. This is the payload
 * of the `virtual:forkable-worker/app` module and the input to
 * `createForkableWorker()`.
 */
export interface ForkableAppManifest {
  /** App name; prefixes every Artifacts repo (`<name>-base`, `<name>-user-*`). */
  name: string;
  /** Seed files every fork starts from, repo-relative path -> content. */
  files: Record<string, string>;
  /** Server entry within the app files, e.g. "src/index.ts". */
  entry: string;
  /** Durable Object class exported by the app entry. */
  appClassName: string;
  /**
   * Content hash of the seed files. Stored by the base repo when it is first
   * seeded; a future version will use a hash change to commit developer
   * updates to the base repo on deploy (so forks see "Pull base updates").
   */
  seedVersion: string;
  /** Build settings for fork rebuilds (client bundling, JSX, dependencies). */
  build?: BuildOptions;
  /** Extra guidance appended to the built-in agent system prompt (AGENT.md). */
  agentInstructions?: string;
  /** Full replacement for the built-in agent system prompt. */
  systemPrompt?: string;
  /** Model slugs for the overlay's fast/capable toggle. */
  models?: { fast?: string; capable?: string };
  /** Override the default binding names (ARTIFACTS, AI, USERAPP, LOADER). */
  bindings?: Partial<BindingNames>;
  /** Compatibility date for dynamically loaded fork workers. */
  compatibilityDate?: string;
  /** Compatibility flags for dynamically loaded fork workers. */
  compatibilityFlags?: string[];
}
