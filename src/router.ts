import { getAgentByName } from "agents";
import { BASE_USER, type ModelChoice } from "./config";

function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export async function handleRequest(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const user = getCookie(request, "user");

  if (url.pathname === "/login" && request.method === "POST") {
    const form = await request.formData();
    const name = String(form.get("name") ?? "").trim().slice(0, 40);
    if (!name) return new Response(null, { status: 302, headers: { Location: "/" } });
    return new Response(null, {
      status: 302,
      headers: {
        Location: "/",
        "Set-Cookie": `user=${encodeURIComponent(name)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`
      }
    });
  }
  if (url.pathname === "/logout") {
    return new Response(null, {
      status: 302,
      headers: { Location: "/", "Set-Cookie": "user=; Path=/; Max-Age=0" }
    });
  }

  // admin: blast all forks + reset base to a single commit (DOs self-heal)
  if (url.pathname === "/admin/reset" && request.method === "POST") {
    if (user !== "admin") return new Response("Forbidden", { status: 403 });
    let cursor: string | undefined;
    let deleted = 0;
    do {
      const page = (await env.ARTIFACTS.list(
        cursor ? { cursor } : {}
      )) as { repos?: Array<{ name: string }>; cursor?: string } | Array<{ name: string }>;
      const repos = Array.isArray(page) ? page : (page.repos ?? []);
      for (const r of repos) {
        // delete user forks; keep the base repo (reset it via force-push)
        if (/^fork-studio-user-/.test(r.name)) {
          await env.ARTIFACTS.delete(r.name);
          deleted++;
        }
      }
      cursor = Array.isArray(page) ? undefined : page.cursor;
    } while (cursor);
    const base = await getAgentByName(env.USERAPP, BASE_USER);
    await base.resetBase();
    const wipedForks = await base.resetForkDOs();
    return Response.json({ ok: true, deletedForks: deleted, wipedForks });
  }

  if (
    url.pathname === "/api/state" ||
    url.pathname === "/api/agent" ||
    url.pathname === "/api/revert" ||
    url.pathname === "/api/merge" ||
    url.pathname === "/api/diag"
  ) {
    if (!user) return new Response("Login required", { status: 401 });
    // `admin` edits the base app itself (the base DO); everyone else their fork
    const target = user === "admin" ? BASE_USER : user;
    const agent = await getAgentByName(env.USERAPP, target);
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

  // everything else == the app. admin + anonymous -> base DO; users -> fork.
  const isAdmin = user === "admin";
  const target = user && !isAdmin ? user : BASE_USER;
  const agent = await getAgentByName(env.USERAPP, target);
  const appBody =
    request.method === "GET" || request.method === "HEAD"
      ? undefined
      : await request.arrayBuffer();
  try {
    return await agent.serve(url.toString(), request.method, isAdmin, appBody);
  } catch (err) {
    return new Response(
      "serve error: " + String(err) + "\n" + ((err as Error)?.stack ?? ""),
      { status: 500 }
    );
  }
}
