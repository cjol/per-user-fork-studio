import { bindings, type ResolvedForkableConfig } from "./config.js";
import { userAppByName } from "./stub.js";
import type { ModelChoice } from "./types.js";

// Top-level host routes: auth (delegated to the provider), admin reset, the
// fork-management API used by the overlay, and app forwarding.
export async function handleRequest(
  request: Request,
  env: Cloudflare.Env,
  cfg: ResolvedForkableConfig
): Promise<Response> {
  const authResponse = await cfg.auth.handleRequest?.(request, env);
  if (authResponse) return authResponse;
  const session = await cfg.auth.identify(request, env);
  const url = new URL(request.url);

  // operator hatch: delete all fork repos + reset base to a single fresh seed
  // commit (DOs self-heal). No UI — call it directly. Base app *content*
  // updates ship by deploying new seed files, not through an admin edit path.
  if (url.pathname === "/admin/reset" && request.method === "POST") {
    if (!session?.isAdmin) return new Response("Forbidden", { status: 403 });
    const artifacts = bindings(env, cfg).artifacts;
    let cursor: string | undefined;
    let deleted = 0;
    do {
      const page = (await artifacts.list(cursor ? { cursor } : {})) as
        | { repos?: Array<{ name: string }>; cursor?: string }
        | Array<{ name: string }>;
      const repos = Array.isArray(page) ? page : (page.repos ?? []);
      for (const r of repos) {
        // delete user forks; keep the base repo (reset it via force-push)
        if (r.name.startsWith(cfg.repoPrefix)) {
          await artifacts.delete(r.name);
          deleted++;
        }
      }
      cursor = Array.isArray(page) ? undefined : page.cursor;
    } while (cursor);
    const base = await userAppByName(env, cfg, cfg.baseUser);
    await base.resetBase();
    const wipedForks = await base.resetForkDOs();
    return Response.json({ ok: true, deletedForks: deleted, wipedForks });
  }

  if (
    url.pathname === "/api/state" ||
    url.pathname === "/api/agent" ||
    url.pathname === "/api/revert" ||
    url.pathname === "/api/merge"
  ) {
    if (!session) return new Response("Login required", { status: 401 });
    const agent = await userAppByName(env, cfg, session.user);
    if (url.pathname === "/api/state") return Response.json(await agent.appState());
    if (url.pathname === "/api/merge") return Response.json(await agent.mergeBase());
    const body = (await request.json().catch(() => ({}))) as {
      prompt?: string;
      oid?: string;
      model?: string;
    };
    if (url.pathname === "/api/agent") {
      const model: ModelChoice = body.model === "fast" ? "fast" : "capable";
      const stream = await agent.streamAgentEdit(String(body.prompt ?? ""), model);
      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          "x-accel-buffering": "no"
        }
      });
    }
    return Response.json(await agent.revertCommit(String(body.oid ?? "")));
  }

  // everything else == the app. anonymous -> base DO; logged in -> your fork.
  const target = session ? session.user : cfg.baseUser;
  const agent = await userAppByName(env, cfg, target);
  const appBody =
    request.method === "GET" || request.method === "HEAD"
      ? undefined
      : await request.arrayBuffer();
  try {
    return await agent.serve(url.toString(), request.method, appBody);
  } catch (err) {
    return new Response(
      "serve error: " + String(err) + "\n" + ((err as Error)?.stack ?? ""),
      { status: 500 }
    );
  }
}
