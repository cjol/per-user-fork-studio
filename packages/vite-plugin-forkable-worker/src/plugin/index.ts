import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type { Plugin, ViteDevServer } from "vite";
import type { BindingNames, ForkableAppManifest } from "../shared/manifest.js";

export interface ForkableWorkerPluginOptions {
  /** Directory whose files seed every user's fork. Default "app". */
  appDir?: string;
  /** Server entry within appDir. Must export the app's Durable Object class. Default "src/index.ts". */
  entry?: string;
  /** Repo name prefix. Default: the project's package.json name. */
  name?: string;
  /** Durable Object class exported by the app entry. Default "App". */
  appClassName?: string;
  /**
   * Module (relative to the project root, or a bare specifier) whose default
   * export is an `AuthProvider`. Default: the built-in cookie auth.
   */
  auth?: string;
  /**
   * Module whose default export is an `AppBundler`. Default: the built-in
   * dependency-free worker-bundler transform.
   */
  bundler?: string;
  /**
   * File inside appDir whose contents are appended to the agent system
   * prompt. Default "AGENT.md" (used only when present).
   */
  agentInstructionsFile?: string;
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
  /** Where the generated host entry is written. Default ".forkable/entry.ts". */
  generatedEntry?: string;
}

const VIRTUAL_ID = "virtual:forkable-worker/app";
const RESOLVED_ID = "\0" + VIRTUAL_ID;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".wrangler", ".forkable"]);

export function forkableWorker(options: ForkableWorkerPluginOptions = {}): Plugin {
  const appDir = options.appDir ?? "app";
  const entry = options.entry ?? "src/index.ts";
  const appClassName = options.appClassName ?? "App";
  const agentInstructionsFile = options.agentInstructionsFile ?? "AGENT.md";
  const generatedEntry = options.generatedEntry ?? ".forkable/entry.ts";

  let root = process.cwd();
  const appDirAbs = () => path.resolve(root, appDir);

  function projectName(): string {
    if (options.name) return options.name;
    try {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(root, "package.json"), "utf8")
      ) as { name?: string };
      if (pkg.name) return pkg.name.replace(/^@[^/]+\//, "");
    } catch {
      /* fall through */
    }
    return "forkable-app";
  }

  function buildManifest(): ForkableAppManifest {
    const dir = appDirAbs();
    if (!fs.existsSync(dir)) {
      throw new Error(
        `[forkable-worker] app directory not found: ${dir}. ` +
          `Set the plugin's \`appDir\` option to the directory of seed files.`
      );
    }
    const files = collectFiles(dir);
    if (!(entry in files)) {
      throw new Error(
        `[forkable-worker] entry "${entry}" not found in ${dir}. ` +
          `Set the plugin's \`entry\` option to the app's server entry file.`
      );
    }
    if (!files[entry].includes(`class ${appClassName} `)) {
      console.warn(
        `[forkable-worker] ${appDir}/${entry} does not appear to declare ` +
          `\`class ${appClassName}\`. Forks are served by mounting that ` +
          `exported Durable Object class; the app will fail to load without it.`
      );
    }
    const agentInstructions = files[agentInstructionsFile];
    return {
      name: projectName(),
      files,
      entry,
      appClassName,
      seedVersion: hashFiles(files),
      agentInstructions,
      systemPrompt: options.systemPrompt,
      models: options.models,
      bindings: options.bindings,
      compatibilityDate: options.compatibilityDate,
      compatibilityFlags: options.compatibilityFlags
    };
  }

  // Rewrite a project-root-relative specifier so it resolves from the
  // generated entry's directory; bare specifiers pass through untouched.
  function entryRelative(spec: string): string {
    if (!spec.startsWith("./") && !spec.startsWith("../")) return spec;
    const entryDir = path.dirname(path.resolve(root, generatedEntry));
    const rel = path
      .relative(entryDir, path.resolve(root, spec))
      .split(path.sep)
      .join("/");
    return rel.startsWith(".") ? rel : `./${rel}`;
  }

  function writeGeneratedEntry(): void {
    const entryPath = path.resolve(root, generatedEntry);
    fs.mkdirSync(path.dirname(entryPath), { recursive: true });
    const overrides: string[] = [];
    const imports: string[] = [];
    if (options.auth) {
      imports.push(`import auth from ${JSON.stringify(entryRelative(options.auth))};`);
      overrides.push("auth");
    }
    if (options.bundler) {
      imports.push(
        `import bundler from ${JSON.stringify(entryRelative(options.bundler))};`
      );
      overrides.push("bundler");
    }
    const code =
      `// Generated by vite-plugin-forkable-worker — do not edit (rewritten on every build).\n` +
      `import { createForkableWorker } from "vite-plugin-forkable-worker/runtime";\n` +
      `import manifest from "virtual:forkable-worker/app";\n` +
      imports.map((l) => l + "\n").join("") +
      `\nconst forkable = createForkableWorker(manifest` +
      (overrides.length ? `, { ${overrides.join(", ")} }` : "") +
      `);\n\n` +
      `export class UserApp extends forkable.UserApp {}\n` +
      `export default forkable.handler;\n`;
    writeIfChanged(entryPath, code);
    // keep the generated directory out of git
    writeIfChanged(path.join(path.dirname(entryPath), ".gitignore"), "*\n");
  }

  return {
    name: "forkable-worker",
    // config must run before @cloudflare/vite-plugin reads the wrangler
    // config, so the generated entry exists when `main` is validated
    enforce: "pre",

    config(config) {
      root = config.root ? path.resolve(config.root) : process.cwd();
      writeGeneratedEntry();
    },

    configResolved(config) {
      root = config.root;
      writeGeneratedEntry();
      validateWranglerConfig(root, generatedEntry, options.bindings);
    },

    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
      return null;
    },

    load(id) {
      if (id !== RESOLVED_ID) return null;
      const manifest = buildManifest();
      // rebuild the seed when app files change (vite build --watch)
      this.addWatchFile(appDirAbs());
      for (const rel of Object.keys(manifest.files)) {
        this.addWatchFile(path.join(appDirAbs(), rel));
      }
      const json = JSON.stringify(manifest, null, 2);
      return (
        `// Seed app files inlined by vite-plugin-forkable-worker (seed ${manifest.seedVersion}).\n` +
        `export default ${json};\n`
      );
    },

    configureServer(server: ViteDevServer) {
      const dir = appDirAbs();
      server.watcher.add(dir);
      const onChange = (file: string) => {
        if (!path.resolve(file).startsWith(dir + path.sep)) return;
        invalidateVirtualModule(server);
        server.ws.send({ type: "full-reload" });
      };
      server.watcher.on("add", onChange);
      server.watcher.on("change", onChange);
      server.watcher.on("unlink", onChange);
    }
  };
}

export default forkableWorker;

function writeIfChanged(file: string, content: string): void {
  try {
    if (fs.readFileSync(file, "utf8") === content) return;
  } catch {
    /* missing — write it */
  }
  fs.writeFileSync(file, content);
}

function collectFiles(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (current: string) => {
    for (const name of fs.readdirSync(current).sort()) {
      if (name === ".DS_Store") continue;
      const abs = path.join(current, name);
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(abs);
        continue;
      }
      const buf = fs.readFileSync(abs);
      if (buf.includes(0)) {
        console.warn(
          `[forkable-worker] skipping binary file ${abs} — seed files must be text`
        );
        continue;
      }
      files[path.relative(dir, abs).split(path.sep).join("/")] = buf.toString("utf8");
    }
  };
  walk(dir);
  return files;
}

function hashFiles(files: Record<string, string>): string {
  const hash = crypto.createHash("sha256");
  for (const key of Object.keys(files).sort()) {
    hash.update(key).update("\0").update(files[key]).update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}

function invalidateVirtualModule(server: ViteDevServer): void {
  // with @cloudflare/vite-plugin the worker runs in its own environment, so
  // invalidate the module in every environment graph we can find
  const environments = Object.values(server.environments ?? {});
  for (const environment of environments) {
    const mod = environment.moduleGraph?.getModuleById(RESOLVED_ID);
    if (mod) environment.moduleGraph.invalidateModule(mod);
  }
  const legacy = server.moduleGraph?.getModuleById(RESOLVED_ID);
  if (legacy) server.moduleGraph.invalidateModule(legacy);
}

// ── wrangler config validation (best-effort, warnings only) ──────────────

interface WranglerShape {
  main?: string;
  compatibility_flags?: string[];
  artifacts?: Array<{ binding?: string }>;
  ai?: { binding?: string };
  durable_objects?: { bindings?: Array<{ name?: string; class_name?: string }> };
  migrations?: Array<{ new_sqlite_classes?: string[] }>;
  worker_loaders?: Array<{ binding?: string }>;
}

function validateWranglerConfig(
  root: string,
  generatedEntry: string,
  bindingOverrides?: Partial<BindingNames>
): void {
  const names: BindingNames = {
    artifacts: "ARTIFACTS",
    ai: "AI",
    userApp: "USERAPP",
    loader: "LOADER",
    ...bindingOverrides
  };
  const file = ["wrangler.jsonc", "wrangler.json"]
    .map((f) => path.join(root, f))
    .find((f) => fs.existsSync(f));
  if (!file) {
    if (fs.existsSync(path.join(root, "wrangler.toml"))) {
      console.warn(
        "[forkable-worker] wrangler.toml found — config validation only " +
          "supports wrangler.json(c), skipping checks."
      );
      return;
    }
    console.warn("[forkable-worker] no wrangler.json(c) found in " + root);
    return;
  }

  let config: WranglerShape;
  try {
    config = JSON.parse(stripJsonComments(fs.readFileSync(file, "utf8")));
  } catch (err) {
    console.warn(`[forkable-worker] could not parse ${file}: ${String(err)}`);
    return;
  }

  const problems: string[] = [];
  if (
    !config.main ||
    path.resolve(root, config.main) !== path.resolve(root, generatedEntry)
  ) {
    problems.push(`"main" should point at the generated entry: "${generatedEntry}"`);
  }
  if (!config.compatibility_flags?.includes("nodejs_compat")) {
    problems.push(`"compatibility_flags" must include "nodejs_compat"`);
  }
  if (!config.artifacts?.some((a) => a.binding === names.artifacts)) {
    problems.push(`an artifacts binding named "${names.artifacts}"`);
  }
  if (config.ai?.binding !== names.ai) {
    problems.push(`an AI binding named "${names.ai}"`);
  }
  if (
    !config.durable_objects?.bindings?.some(
      (b) => b.name === names.userApp && b.class_name === "UserApp"
    )
  ) {
    problems.push(
      `a durable object binding "${names.userApp}" with class_name "UserApp"`
    );
  }
  if (!config.migrations?.some((m) => m.new_sqlite_classes?.includes("UserApp"))) {
    problems.push(`a migration with new_sqlite_classes ["UserApp"]`);
  }
  if (!config.worker_loaders?.some((l) => l.binding === names.loader)) {
    problems.push(`a worker_loaders binding named "${names.loader}"`);
  }

  if (problems.length) {
    console.warn(
      `[forkable-worker] ${path.basename(file)} is missing pieces the harness needs:\n` +
        problems.map((p) => `  - ${p}`).join("\n") +
        `\nExpected shape:\n` +
        JSON.stringify(
          {
            main: generatedEntry,
            compatibility_flags: ["nodejs_compat"],
            artifacts: [{ binding: names.artifacts, namespace: "default", remote: true }],
            ai: { binding: names.ai },
            durable_objects: {
              bindings: [{ name: names.userApp, class_name: "UserApp" }]
            },
            migrations: [{ tag: "v1", new_sqlite_classes: ["UserApp"] }],
            worker_loaders: [{ binding: names.loader }]
          },
          null,
          2
        )
    );
  }
}

/** Tolerant JSONC: strips // and block comments plus trailing commas. */
function stripJsonComments(input: string): string {
  let out = "";
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    const next = input[i + 1];
    if (inLine) {
      if (c === "\n") {
        inLine = false;
        out += c;
      }
      continue;
    }
    if (inBlock) {
      if (c === "*" && next === "/") {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += c;
      if (c === "\\") {
        out += next ?? "";
        i++;
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === "/" && next === "/") {
      inLine = true;
      i++;
      continue;
    }
    if (c === "/" && next === "*") {
      inBlock = true;
      i++;
      continue;
    }
    out += c;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}
