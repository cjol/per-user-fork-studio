import type { AuthProvider } from "./types.js";

export interface CookieAuthOptions {
  /** Cookie holding the visitor's name. Default "user". */
  cookieName?: string;
  /** Name allowed to call the /admin/reset operator endpoint. Default "admin". */
  adminUser?: string;
  /** Cookie lifetime in seconds. Default 86400 (one day). */
  maxAge?: number;
}

function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

/**
 * The prototype's honor-system login: visitors pick a name, the name lives in
 * a cookie, and one fixed name is the admin. Fine for demos; replace with a
 * real `AuthProvider` (Cloudflare Access, JWT, session store) for anything
 * user-facing — nothing stops a visitor from claiming any name, including the
 * admin's.
 */
export function cookieAuth(options: CookieAuthOptions = {}): AuthProvider {
  const cookieName = options.cookieName ?? "user";
  const adminUser = options.adminUser ?? "admin";
  const maxAge = options.maxAge ?? 86400;
  return {
    identify(request) {
      const user = getCookie(request, cookieName);
      if (!user) return null;
      return { user, isAdmin: user === adminUser };
    },
    async handleRequest(request) {
      const url = new URL(request.url);
      if (url.pathname === "/login" && request.method === "POST") {
        const form = await request.formData();
        const name = String(form.get("name") ?? "")
          .trim()
          .slice(0, 40);
        if (!name) {
          return new Response(null, { status: 302, headers: { Location: "/" } });
        }
        return new Response(null, {
          status: 302,
          headers: {
            Location: "/",
            "Set-Cookie": `${cookieName}=${encodeURIComponent(name)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`
          }
        });
      }
      if (url.pathname === "/logout") {
        return new Response(null, {
          status: 302,
          headers: {
            Location: "/",
            "Set-Cookie": `${cookieName}=; Path=/; Max-Age=0`
          }
        });
      }
      return null;
    },
    loginPanelHtml() {
      return (
        '<h3>Fork this app</h3><p class="muted">Pick a name to get your own private copy you can change with AI.</p>' +
        '<form method="POST" action="/login"><input name="name" placeholder="e.g. alice" required/>' +
        '<button class="act" type="submit">Create my fork</button></form>'
      );
    }
  };
}
