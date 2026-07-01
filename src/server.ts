// Per-user fork studio — Think agent edition.
//
//   /            -> the rendered React app (anonymous: base; logged-in: your
//                   fork). A host-injected floating fork button overlays it.
//   fork button  -> panel with an AI prompt box + commit history (with revert).
//   /api/agent   -> a @cloudflare/think agent, with YOUR Workspace mounted, runs
//                   an agentic edit loop (read/edit file tools) to apply the
//                   natural-language change, then we rebuild + commit + push.
//   /api/revert  -> restore a previous commit's code as a new commit.
//
// Per-user Artifacts fork + Workspace/git + worker-bundler + Worker Loader.

import { Think, Workspace } from "@cloudflare/think";
import { getAgentByName } from "agents";
import { WorkspaceFileSystem } from "@cloudflare/shell";
import { createGit, type Git } from "@cloudflare/shell/git";
import {
  createApp,
  handleAssetRequest,
  createMemoryStorage,
  type CreateAppResult
} from "@cloudflare/worker-bundler";
import { createWorkersAI } from "workers-ai-provider";
import { openai } from "workers-ai-provider/openai";
import { BASE_FILES } from "./base-app";
import { appOverlay } from "./overlay";
import { handleRequest } from "./router";
import {
  AGENT_SYSTEM,
  BASE_REPO,
  BASE_USER,
  CAPABLE_MODEL,
  FAST_MODEL,
  author,
  repoNameFor,
  secret,
  type ModelChoice
} from "./config";
import type { AppState, LogEntry } from "./types";

export class UserApp extends Think<Env> {
  // The per-user git working tree is the agent's mounted Workspace, so Think's
  // file tools edit the same files we bundle + push.
  override workspace = new Workspace({
    sql: this.ctx.storage.sql,
    namespace: "user",
    name: () => this.name
  });
  workspaceBash = false; // file edits only; no sandboxed shell
  // abort a turn whose model stream stalls (overloaded model) instead of
  // spinning forever
  chatStreamStallTimeoutMs = 120000;

  private gitInstance?: Git;
  private build?: CreateAppResult;
  private buildVersion = 0;
  private facetVersion = -1;
  private facetGen = 0; // bump to abandon a fork's persisted app data
  private readyPromise?: Promise<void>;

  private modelChoice: ModelChoice = "capable"; // set per turn from the toggle

  getModel() {
    const model = this.modelChoice === "fast" ? FAST_MODEL : CAPABLE_MODEL;
    if (model.startsWith("@cf/")) {
      return createWorkersAI({ binding: this.env.AI })(model);
    }
    if (model.startsWith("openai/")) {
      // OpenAI catalog via the env.AI slug delegate (Unified Billing, no token)
      return createWorkersAI({ binding: this.env.AI, providers: [openai] })(model);
    }
    return createWorkersAI({ binding: this.env.AI, providers: [openai] })(model);
  }
  getSystemPrompt() {
    return AGENT_SYSTEM;
  }

  private get isBase() {
    return this.name === BASE_USER;
  }
  private git(): Git {
    if (!this.gitInstance) {
      this.gitInstance = createGit(new WorkspaceFileSystem(this.workspace), "/repo");
    }
    return this.gitInstance;
  }

  // Ensure the base repo exists and return its remote. The base DO is the sole
  // creator, so it always has the remote recorded (needed to clone/push base).
  private async ensureBaseRepo(): Promise<string> {
    const stored = await this.ctx.storage.get<string>("baseRemote");
    if (stored) {
      try {
        await this.env.ARTIFACTS.get(BASE_REPO);
        return stored; // still exists
      } catch {
        await this.ctx.storage.delete("baseRemote"); // was reset — recreate
      }
    }
    // if the repo already exists (e.g. its remote just wasn't recorded here),
    // look it up via list() instead of recreating — avoids same-name races
    const existing = await this.findBaseRemote();
    if (existing) {
      await this.ctx.storage.put("baseRemote", existing);
      return existing;
    }
    const created = await this.env.ARTIFACTS.create(BASE_REPO, {
      setDefaultBranch: "main",
      description: "Base app forked by every studio user"
    });
    // record the remote immediately so a later seed failure is recoverable
    await this.ctx.storage.put("baseRemote", created.remote);
    const seedHandle = await this.env.ARTIFACTS.get(BASE_REPO);
    const writeToken = secret(
      (await seedHandle.createToken("write", 3600)).plaintext
    );
    const seedWs = new Workspace({
      sql: this.ctx.storage.sql,
      namespace: "baseseed",
      name: () => "baseseed"
    });
    // wipe any leftover seed tree from a previous (pre-reset) seeding
    try {
      await seedWs.rm("/seed", { recursive: true });
    } catch {
      /* nothing to remove */
    }
    const seedGit = createGit(new WorkspaceFileSystem(seedWs), "/seed");
    await seedGit.init({ defaultBranch: "main" });
    for (const [path, content] of Object.entries(BASE_FILES)) {
      await seedWs.writeFile(`/seed/${path}`, content);
    }
    await seedGit.add({ filepath: "." });
    await seedGit.commit({ message: "Base app", author });
    await seedGit
      .remote({ add: { name: "origin", url: created.remote } })
      .catch(() => undefined);
    await seedGit.push({
      remote: "origin",
      ref: "main",
      username: "x",
      password: writeToken
    });
    return created.remote;
  }

  // Look up the base repo's git remote from list() (which includes `remote`).
  private async findBaseRemote(): Promise<string | undefined> {
    let cursor: string | undefined;
    do {
      const page = (await this.env.ARTIFACTS.list(
        cursor ? { cursor } : {}
      )) as
        | { repos?: Array<{ name: string; remote?: string }>; cursor?: string }
        | Array<{ name: string; remote?: string }>;
      const repos = Array.isArray(page) ? page : (page.repos ?? []);
      const base = repos.find((r) => r.name === BASE_REPO);
      if (base?.remote) return base.remote;
      cursor = Array.isArray(page) ? undefined : page.cursor;
    } while (cursor);
    return undefined;
  }

  // RPC: forks call this on the base DO so the base DO is the sole creator.
  async ensureBaseExists(): Promise<string> {
    return this.ensureBaseRepo();
  }

  // RPC (base DO): registry of fork user names so admin reset can actively wipe
  // each fork's DO (warm DOs won't self-heal on their own).
  async registerFork(name: string): Promise<void> {
    const names = (await this.ctx.storage.get<string[]>("forkNames")) ?? [];
    if (!names.includes(name)) {
      names.push(name);
      await this.ctx.storage.put("forkNames", names);
    }
  }

  // RPC (base DO): reset every known fork DO (clears workspace, app data, and
  // forces a re-fork on next visit), then clear the registry.
  async resetForkDOs(): Promise<number> {
    const names = (await this.ctx.storage.get<string[]>("forkNames")) ?? [];
    for (const name of names) {
      try {
        const stub = await getAgentByName(this.env.USERAPP, name);
        await stub.resetSelf();
      } catch {
        /* ignore individual failures */
      }
    }
    await this.ctx.storage.put("forkNames", []);
    return names.length;
  }

  private async bootstrap(): Promise<void> {
    if (this.isBase) return this.bootstrapBase();
    return this.bootstrapFork();
  }

  // The base DO clones (and serves) the real base repo, so admin edits show
  // on the public landing page.
  private async bootstrapBase(): Promise<void> {
    const baseRemote = await this.ensureBaseRepo();
    const handle = await this.env.ARTIFACTS.get(BASE_REPO);
    const readToken = secret((await handle.createToken("read", 3600)).plaintext);
    await this.git().clone({
      url: baseRemote,
      branch: "main",
      singleBranch: true,
      username: "x",
      password: readToken
    });
    await this.ctx.storage.put("repo", BASE_REPO);
    await this.ctx.storage.put("remote", baseRemote);
    await this.ctx.storage.put("forked", true);
  }

  private async bootstrapFork(): Promise<void> {
    // Suffix the generation so a re-fork after reset uses a NEW repo name —
    // avoids the eventual-consistency race of recreating a just-deleted name.
    const repo = `${repoNameFor(this.name)}-g${this.facetGen}`;
    // base DO is the sole creator of the base repo
    const baseStub = await getAgentByName(this.env.USERAPP, BASE_USER);
    await baseStub.ensureBaseExists();
    await baseStub.registerFork(this.name); // so admin reset can wipe this DO
    const baseHandle = await this.env.ARTIFACTS.get(BASE_REPO);
    const forked = await baseHandle.fork(repo, {
      description: `Personal fork for ${this.name}`
    });
    const handle = await this.env.ARTIFACTS.get(repo);
    const readToken = secret((await handle.createToken("read", 3600)).plaintext);
    await this.git().clone({
      url: forked.remote,
      branch: "main",
      singleBranch: true,
      username: "x",
      password: readToken
    });
    await this.ctx.storage.put("repo", repo);
    await this.ctx.storage.put("remote", forked.remote);
    await this.ctx.storage.put("forked", true);
    await this.markBaseMerged();
  }

  // Tip commit of the base repo, read cheaply via the Artifacts binding.
  private async baseTipOid(): Promise<string | undefined> {
    try {
      const handle = (await this.env.ARTIFACTS.get(BASE_REPO)) as ArtifactsRepo & {
        log(opts?: { ref?: string; limit?: number }): Promise<unknown>;
      };
      const r: unknown = await handle.log({ ref: "main", limit: 1 });
      const arr = Array.isArray(r)
        ? r
        : ((r as { commits?: unknown[] })?.commits ?? []);
      const first = arr[0] as { hash?: string; oid?: string } | undefined;
      return first?.hash ?? first?.oid;
    } catch {
      return undefined;
    }
  }

  // True when base has a tip we haven't incorporated yet.
  private async isBaseAhead(): Promise<boolean> {
    if (this.isBase) return false;
    const tip = await this.baseTipOid();
    if (!tip) return false;
    const merged = await this.ctx.storage.get<string>("mergedBaseTip");
    return tip !== merged;
  }

  private async markBaseMerged(): Promise<void> {
    const tip = await this.baseTipOid();
    if (tip) await this.ctx.storage.put("mergedBaseTip", tip);
  }

  private async readFiles(): Promise<Record<string, string>> {
    const entries = (await this.workspace
      .glob("/repo/**/*")
      .catch(() => [] as Array<{ path: string; type: string }>)) as Array<{
      path: string;
      type: string;
    }>;
    const files: Record<string, string> = {};
    for (const e of entries) {
      if (e.type !== "file" || e.path.includes("/.git/")) continue;
      try {
        const content = await this.workspace.readFile(e.path);
        if (content !== null) files[e.path.replace(/^\/repo\//, "")] = content;
      } catch {
        /* skip */
      }
    }
    return files;
  }

  private async rebuild(files: Record<string, string>): Promise<void> {
    // No client entry / no deps -> a fast sucrase transform (no esbuild bundling
    // of npm packages), which keeps the DO isolate's memory use low.
    this.build = await createApp({ files, server: "src/index.ts" });
    this.buildVersion++;
  }

  private async ensureReady(): Promise<void> {
    if (!this.readyPromise) {
      this.readyPromise = (async () => {
        this.facetGen = (await this.ctx.storage.get<number>("facetGen")) ?? 0;
        let forked = await this.ctx.storage.get<boolean>("forked");
        // self-heal: if our repo was blasted, wipe and re-bootstrap fresh
        if (forked) {
          const repo = await this.ctx.storage.get<string>("repo");
          let exists = false;
          try {
            if (repo) {
              await this.env.ARTIFACTS.get(repo);
              exists = true;
            }
          } catch {
            exists = false;
          }
          if (!exists) {
            await this.resetForReseed();
            forked = false;
          }
        }
        if (!forked) await this.bootstrap();
        await this.rebuild(await this.readFiles());
      })();
      // clear the latch if setup fails, so a later request can retry cleanly
      this.readyPromise.catch(() => {
        this.readyPromise = undefined;
      });
    }
    return this.readyPromise;
  }

  // Clear local fork/base state so the next ensureReady re-bootstraps fresh.
  private async resetForReseed(): Promise<void> {
    try {
      await this.workspace.rm("/repo", { recursive: true });
    } catch {
      /* nothing to remove */
    }
    for (const k of ["forked", "repo", "remote", "mergedBaseTip", "baseRemote"]) {
      await this.ctx.storage.delete(k);
    }
    // abandon this fork's persisted app data by bumping the facet generation
    // (a new generation = a new facet name = fresh, empty storage)
    const oldGen = (await this.ctx.storage.get<number>("facetGen")) ?? 0;
    try {
      this.facetsApi().abort(`app-${oldGen}`, new Error("reset"));
    } catch {
      /* no live facet */
    }
    this.facetGen = oldGen + 1;
    await this.ctx.storage.put("facetGen", this.facetGen);
    this.build = undefined;
    this.gitInstance = undefined;
    this.buildVersion = 0;
    this.facetVersion = -1;
  }

  // RPC: force this DO to drop its state (used by the admin reset).
  async resetSelf(): Promise<void> {
    await this.resetForReseed();
    this.readyPromise = undefined;
  }

  // RPC: reset the base repo to a single fresh commit via force-push (the repo
  // is NOT deleted — avoids same-name recreate races), then drop local state.
  async resetBase(): Promise<void> {
    const baseRemote = await this.ensureBaseRepo();
    const seedWs = new Workspace({
      sql: this.ctx.storage.sql,
      namespace: "baseseed",
      name: () => "baseseed"
    });
    try {
      await seedWs.rm("/seed", { recursive: true });
    } catch {
      /* nothing to remove */
    }
    const seedGit = createGit(new WorkspaceFileSystem(seedWs), "/seed");
    await seedGit.init({ defaultBranch: "main" });
    for (const [path, content] of Object.entries(BASE_FILES)) {
      await seedWs.writeFile(`/seed/${path}`, content);
    }
    await seedGit.add({ filepath: "." });
    await seedGit.commit({ message: "Base app", author });
    await seedGit
      .remote({ add: { name: "origin", url: baseRemote } })
      .catch(() => undefined);
    const writeToken = secret(
      (await (await this.env.ARTIFACTS.get(BASE_REPO)).createToken("write", 3600))
        .plaintext
    );
    await seedGit.push({
      remote: "origin",
      ref: "main",
      force: true,
      username: "x",
      password: writeToken
    });
    await this.resetForReseed();
    this.readyPromise = undefined;
  }

  private async currentLog(): Promise<LogEntry[]> {
    try {
      const entries = await this.git().log({ depth: 30 });
      return entries.map((c) => ({
        oid: c.oid,
        short: c.oid.slice(0, 7),
        message: c.message.split("\n")[0]
      }));
    } catch {
      return [];
    }
  }

  private async snapshotState(
    error?: string,
    note?: string
  ): Promise<AppState> {
    return {
      user: this.name,
      repo: (await this.ctx.storage.get<string>("repo")) ?? "",
      loggedIn: !this.isBase,
      pushedToFork: true,
      log: await this.currentLog(),
      baseAhead: false,
      error,
      note
    };
  }

  private async pushOrigin(): Promise<boolean> {
    try {
      const repo = (await this.ctx.storage.get<string>("repo"))!;
      const handle = await this.env.ARTIFACTS.get(repo);
      const writeToken = secret(
        (await handle.createToken("write", 3600)).plaintext
      );
      await this.git().push({
        remote: "origin",
        ref: "main",
        username: "x",
        password: writeToken
      });
      return true;
    } catch {
      return false;
    }
  }

  private async commitAndPush(message: string): Promise<boolean> {
    const git = this.git();
    await git.add({ filepath: "." });
    await git.commit({ message, author });
    return this.pushOrigin();
  }

  // Pull updates from the base repo (upstream) into this fork via git merge.
  async mergeBase(): Promise<AppState> {
    await this.ensureReady();
    if (this.isBase) return this.snapshotState("Base app has no upstream.");
    const git = this.git();
    const remote = (await this.ctx.storage.get<string>("remote")) ?? "";
    // base lives in the same namespace/account — derive its remote URL
    const baseRemote = remote.replace(/[^/]+\.git$/, `${BASE_REPO}.git`);
    const baseHandle = await this.env.ARTIFACTS.get(BASE_REPO);
    const baseRead = secret(
      (await baseHandle.createToken("read", 3600)).plaintext
    );
    try {
      await git
        .remote({ add: { name: "base", url: baseRemote } })
        .catch(() => undefined); // idempotent if already added
      const before = (await git.log({ depth: 1 }))[0]?.oid;
      await git.pull({
        remote: "base",
        ref: "main",
        author,
        username: "x",
        password: baseRead
      });
      const after = (await git.log({ depth: 1 }))[0]?.oid;
      if (before === after) {
        return this.snapshotState(undefined, "Already up to date with base.");
      }
      await this.rebuild(await this.readFiles());
      const pushed = await this.pushOrigin();
      await this.markBaseMerged();
      const s = await this.snapshotState(undefined, "Merged base updates.");
      s.pushedToFork = pushed;
      return s;
    } catch (err) {
      if (/conflict/i.test(String(err))) {
        // base and fork changed the same lines — let the agent reconcile
        return this.resolveConflictWithAgent();
      }
      try {
        await git.checkout({ ref: "main", force: true });
        await this.rebuild(await this.readFiles());
      } catch {
        /* ignore */
      }
      return this.snapshotState("Could not merge base: " + String(err).slice(0, 160));
    }
  }

  // Conflict path: capture the base's version, restore ours, then have the
  // Think agent reconcile the two into a buildable result.
  private async resolveConflictWithAgent(): Promise<AppState> {
    const git = this.git();
    // discard the partial/aborted merge state
    await git.checkout({ ref: "main", force: true });

    // grab the base's version of the file(s) by checking out the fetched ref
    let theirs: Record<string, string> = {};
    try {
      await git.checkout({ ref: "base/main", force: true });
      theirs = await this.readFiles();
    } catch {
      try {
        await git.checkout({ ref: "refs/remotes/base/main", force: true });
        theirs = await this.readFiles();
      } catch {
        /* fall through */
      }
    }
    await git.checkout({ ref: "main", force: true }); // back to our side

    const baseSrc = theirs["src/index.ts"] ?? "";
    const prompt =
      "We are pulling updates from the base app into this fork, but the base " +
      "and this fork changed the same lines, so a plain git merge conflicts. " +
      "Your fork's current src/index.ts is in the workspace. Below is the " +
      "BASE's new version of src/index.ts. Edit /repo/src/index.ts so it " +
      "incorporates the base's changes while preserving this fork's own " +
      "customizations. Keep `export class App extends DurableObject` valid and " +
      "remove nothing important from either side.\n\n===== BASE src/index.ts =====\n" +
      baseSrc +
      "\n===== END BASE =====";

    try {
      await this.saveMessages([
        {
          id: crypto.randomUUID(),
          role: "user",
          parts: [{ type: "text", text: prompt }]
        }
      ]);
    } catch (err) {
      await git.checkout({ ref: "main", force: true });
      await this.rebuild(await this.readFiles());
      return this.snapshotState("Agent failed to resolve conflict: " + String(err).slice(0, 160));
    }

    const files = await this.readFiles();
    if (Object.values(files).some((c) => c.includes("<<<<<<<"))) {
      await git.checkout({ ref: "main", force: true });
      await this.rebuild(await this.readFiles());
      return this.snapshotState("Agent left unresolved conflict markers — try again.");
    }
    try {
      await this.rebuild(files);
    } catch (err) {
      await git.checkout({ ref: "main", force: true });
      await this.rebuild(await this.readFiles());
      return this.snapshotState("Agent's merge did not build: " + String(err).slice(0, 160));
    }

    const pushed = await this.commitAndPush("Merge base updates (AI-resolved conflict)");
    await this.markBaseMerged();
    const s = await this.snapshotState(
      undefined,
      "Merged base updates — conflict resolved by AI."
    );
    s.pushedToFork = pushed;
    return s;
  }

  // ── RPC methods (called by the top-level worker) ────────────────────
  async appState(): Promise<AppState> {
    await this.ensureReady();
    const s = await this.snapshotState();
    s.baseAhead = await this.isBaseAhead();
    return s;
  }

  // Streaming agentic edit: Think reads + edits files via its workspace tools,
  // emitting loop events that we forward to the client over SSE. After the turn
  // we rebuild + commit/push; broken output rolls back to the last commit.
  streamAgentEdit(prompt: string, model: ModelChoice = "capable"): ReadableStream {
    this.modelChoice = model;
    const enc = new TextEncoder();
    let controller: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      }
    });
    const send = (obj: unknown) => {
      try {
        controller.enqueue(enc.encode("data: " + JSON.stringify(obj) + "\n\n"));
      } catch {
        /* stream closed */
      }
    };
    const close = () => {
      try {
        controller.close();
      } catch {
        /* already closed */
      }
    };

    const run = async () => {
      try {
        await this.ensureReady();
        send({ kind: "status", text: "Agent starting…" });

        const before = JSON.stringify(await this.readFiles());
        let chatError = "";
        let changed = false;
        // overloaded models sometimes return an empty turn — retry once
        for (let attempt = 1; attempt <= 2 && !changed; attempt++) {
          if (attempt > 1) {
            send({ kind: "status", text: "Model returned no edits — retrying…" });
          }
          chatError = "";
          await this.chat(prompt, {
            onStart: () => send({ kind: "status", text: "Thinking…" }),
            onEvent: (json: string) => send({ kind: "event", chunk: json }),
            onDone: () => undefined,
            onError: (err: string) => {
              chatError = err;
            }
          }).catch((err) => {
            chatError = String(err);
          });
          if (chatError) break;
          changed = JSON.stringify(await this.readFiles()) !== before;
        }

        if (chatError) {
          send({ kind: "done", error: "Agent error: " + chatError.slice(0, 200) });
          return close();
        }
        if (!changed) {
          send({
            kind: "done",
            error: "Agent made no changes (the model may be overloaded). Try again."
          });
          return close();
        }

        send({ kind: "status", text: "Building & pushing…" });
        const files = await this.readFiles();
        try {
          await this.rebuild(files);
        } catch (err) {
          try {
            await this.git().checkout({ ref: "main", force: true });
            await this.rebuild(await this.readFiles());
          } catch {
            /* ignore */
          }
          send({ kind: "done", error: "Build failed: " + String(err).slice(0, 200) });
          return close();
        }
        const pushed = await this.commitAndPush(prompt.slice(0, 72));
        send({ kind: "done", ok: true, pushedToFork: pushed });
        close();
      } catch (err) {
        send({ kind: "done", error: String(err).slice(0, 200) });
        close();
      }
    };
    run();
    return stream;
  }

  async revertCommit(oid: string): Promise<AppState> {
    const git = this.git();
    try {
      await git.checkout({ ref: oid, force: true });
      const old = await this.readFiles();
      await git.checkout({ ref: "main", force: true });
      for (const [path, content] of Object.entries(old)) {
        await this.workspace.writeFile(`/repo/${path}`, content);
      }
      await this.rebuild(old);
      const pushed = await this.commitAndPush(`Revert to ${oid.slice(0, 7)}`);
      const s = await this.snapshotState();
      s.pushedToFork = pushed;
      return s;
    } catch (err) {
      try {
        await git.checkout({ ref: "main", force: true });
      } catch {
        /* ignore */
      }
      return this.snapshotState(String(err));
    }
  }

  private overlay(asAdmin: boolean): string {
    return appOverlay(asAdmin, asAdmin ? true : !this.isBase, this.name);
  }

  // Load the bundled worker and mount its `App` DurableObject as a facet.
  // On a new build, abort the old facet so the code refreshes but its
  // persistent storage is preserved.
  private facetsApi() {
    return (
      this.ctx as unknown as {
        facets: {
          get<T>(name: string, init: () => { class: unknown; id: string }): T;
          abort(name: string, err: Error): void;
        };
      }
    ).facets;
  }

  private appFacet(built: CreateAppResult): Fetcher {
    const loaderId = `${this.name}-v${this.buildVersion}`;
    const worker = this.env.LOADER.get(loaderId, () => ({
      mainModule: built.mainModule,
      modules: built.modules,
      compatibilityDate: "2026-06-11",
      compatibilityFlags: ["nodejs_compat"]
    }));
    const facets = this.facetsApi();
    // facet identity is its NAME, so the generation goes in the name: a reset
    // (gen bump) yields a brand-new facet with empty storage; same-gen rebuilds
    // reuse it (code refreshes, storage preserved).
    const facetName = `app-${this.facetGen}`;
    if (this.facetVersion !== this.buildVersion) {
      try {
        facets.abort(facetName, new Error("rebuilding app"));
      } catch {
        /* no live facet */
      }
      this.facetVersion = this.buildVersion;
    }
    return facets.get<Fetcher>(facetName, () => ({
      class: worker.getDurableObjectClass("App"),
      id: facetName
    }));
  }

  async serve(
    reqUrl: string,
    method: string,
    asAdmin = false,
    body?: ArrayBuffer
  ): Promise<Response> {
    await this.ensureReady();
    if (!this.build) await this.rebuild(await this.readFiles());
    const built = this.build!;
    const request = new Request(reqUrl, {
      method,
      body: body && body.byteLength > 0 ? body : undefined
    });

    const assetRes = await handleAssetRequest(
      request,
      built.assetManifest,
      createMemoryStorage(built.assets ?? {}),
      built.assetConfig
    );
    if (assetRes) return assetRes;

    // Mount the app's exported `App` Durable Object class as a per-fork facet:
    // a dynamic DO with its own persistent storage. Forwarded requests hit it.
    const resp = await this.appFacet(built).fetch(request);

    const ct = resp.headers.get("content-type") ?? "";
    if (!ct.includes("text/html")) return resp;
    let html = await resp.text();
    const inject = this.overlay(asAdmin);
    html = html.includes("</body>")
      ? html.replace("</body>", inject + "</body>")
      : html + inject;
    return new Response(html, {
      status: resp.status,
      headers: { "content-type": "text/html;charset=utf-8" }
    });
  }
}

export default {
  fetch: handleRequest
};
