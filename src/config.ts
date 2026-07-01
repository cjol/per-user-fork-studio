export const BASE_REPO = "fork-studio-base";
export const BASE_USER = "__base__";
export const FAST_MODEL = "@cf/zai-org/glm-4.7-flash";
export const CAPABLE_MODEL = "openai/gpt-5.4";
export const author = { name: "Fork Studio", email: "studio@example.com" };

export type ModelChoice = "fast" | "capable";

export const secret = (token: string) => token.split("?")[0];

export function repoNameFor(user: string): string {
  const slug = user
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return `fork-studio-user-${slug || "anon"}`;
}

export const AGENT_SYSTEM =
  "You are an expert Cloudflare Workers engineer editing a SINGLE file: " +
  "/repo/src/index.ts. It exports `class App extends DurableObject` (from " +
  "cloudflare:workers). Its async fetch() server-renders an HTML dashboard " +
  "(see the page() helper: plain HTML string + inline vanilla JS in CLIENT_JS) " +
  "and a JSON API persisted in this.ctx.storage (KV-style get/put). Use the " +
  "file tools (read, edit) and make the SMALLEST edits. Rules: keep " +
  "`export class App extends DurableObject` with an async fetch(request); the " +
  "UI is plain HTML + inline JS — do NOT add React or any npm dependency or a " +
  "build step; persist data via this.ctx.storage; don't link to other pages " +
  "(the host provides app chrome).";
