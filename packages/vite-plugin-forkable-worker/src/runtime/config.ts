import type { BindingNames, ForkableAppManifest } from "../shared/manifest.js";
import type { AppBundler, AuthProvider } from "./types.js";
import { cookieAuth } from "./auth.js";
import { workerBundler } from "./bundler.js";

/** Code-level extension points, passed alongside the build-time manifest. */
export interface RuntimeOverrides {
  auth?: AuthProvider;
  bundler?: AppBundler;
}

export interface ResolvedForkableConfig {
  name: string;
  files: Record<string, string>;
  entry: string;
  appClassName: string;
  seedVersion: string;
  baseRepo: string;
  /** Reserved DO name that owns the base repo and serves anonymous visitors. */
  baseUser: string;
  repoPrefix: string;
  models: { fast: string; capable: string };
  bindings: BindingNames;
  compatibilityDate: string;
  compatibilityFlags: string[];
  systemPrompt: string;
  author: { name: string; email: string };
  auth: AuthProvider;
  bundler: AppBundler;
}

export const DEFAULT_BINDINGS: BindingNames = {
  artifacts: "ARTIFACTS",
  ai: "AI",
  userApp: "USERAPP",
  loader: "LOADER"
};

const DEFAULT_FAST_MODEL = "@cf/zai-org/glm-4.7-flash";
const DEFAULT_CAPABLE_MODEL = "openai/gpt-5.4";

/** Artifacts tokens embed query params; git wants the bare secret. */
export const secret = (token: string) => token.split("?")[0];

export function repoNameFor(cfg: ResolvedForkableConfig, user: string): string {
  const slug = user
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return `${cfg.repoPrefix}${slug || "anon"}`;
}

/** Does the seed's package.json declare runtime dependencies? */
function seedHasDependencies(files: Record<string, string>): boolean {
  try {
    const pkg = JSON.parse(files["package.json"] ?? "{}") as {
      dependencies?: Record<string, string>;
    };
    return Object.keys(pkg.dependencies ?? {}).length > 0;
  } catch {
    return false;
  }
}

function defaultSystemPrompt(manifest: ForkableAppManifest): string {
  const cls = manifest.appClassName;
  const build = manifest.build ?? {};
  const allowDeps = build.allowDependencies ?? seedHasDependencies(manifest.files);
  let prompt =
    "You are an expert Cloudflare Workers engineer editing a user's personal " +
    "fork of a small app. The app's files live under /repo. The server entry " +
    `is /repo/${manifest.entry} and it MUST keep ` +
    `\`export class ${cls} extends DurableObject\` (from "cloudflare:workers") ` +
    "with an async fetch(request) method. Use the file tools (read, edit) and " +
    "make the SMALLEST edits that satisfy the request.";
  if (build.client) {
    const clients = Array.isArray(build.client) ? build.client : [build.client];
    const served = clients.map(
      (c) => `/repo/${c} (served at /${c.replace(/^src\//, "").replace(/\.(tsx?|jsx?)$/, ".js")})`
    );
    prompt +=
      ` Browser code is bundled from ${served.join(", ")}; files under ` +
      `/repo/${build.assetsDir ?? "public"}/ are served as static assets.`;
  }
  prompt += " Rules: ";
  prompt += allowDeps
    ? "npm dependencies declared in package.json are installed at build " +
      "time — you may add a package there when strictly needed, but prefer " +
      "the existing stack (installs slow the app's rebuild); "
    : "do NOT add npm dependencies or a build step; ";
  prompt +=
    "persist data via this.ctx.storage; never " +
    `remove the ${cls} export; the host application provides outer chrome, so ` +
    "don't add links to other pages.";
  if (manifest.agentInstructions) {
    prompt += "\n\nApp-specific instructions:\n" + manifest.agentInstructions;
  }
  return prompt;
}

export function resolveConfig(
  manifest: ForkableAppManifest,
  overrides: RuntimeOverrides = {}
): ResolvedForkableConfig {
  const name = manifest.name.replace(/[^a-zA-Z0-9-]+/g, "-").toLowerCase();
  return {
    name,
    files: manifest.files,
    entry: manifest.entry,
    appClassName: manifest.appClassName,
    seedVersion: manifest.seedVersion,
    baseRepo: `${name}-base`,
    baseUser: "__base__",
    repoPrefix: `${name}-user-`,
    models: {
      fast: manifest.models?.fast ?? DEFAULT_FAST_MODEL,
      capable: manifest.models?.capable ?? DEFAULT_CAPABLE_MODEL
    },
    bindings: { ...DEFAULT_BINDINGS, ...manifest.bindings },
    compatibilityDate: manifest.compatibilityDate ?? "2026-06-11",
    compatibilityFlags: manifest.compatibilityFlags ?? ["nodejs_compat"],
    systemPrompt: manifest.systemPrompt ?? defaultSystemPrompt(manifest),
    author: { name: "Forkable Worker", email: `${name}@forkable.invalid` },
    auth: overrides.auth ?? cookieAuth(),
    bundler: overrides.bundler ?? workerBundler(manifest.build)
  };
}

/** Typed accessors for the host worker's bindings, by configured name. */
export function bindings(env: Cloudflare.Env, cfg: ResolvedForkableConfig) {
  const record = env as Record<string, unknown>;
  return {
    artifacts: record[cfg.bindings.artifacts] as Artifacts,
    ai: record[cfg.bindings.ai] as Ai,
    userApp: record[cfg.bindings.userApp] as DurableObjectNamespace,
    loader: record[cfg.bindings.loader] as WorkerLoader
  };
}
