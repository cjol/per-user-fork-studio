import { DurableObject } from "cloudflare:workers";

// Server side of the notes app: a JSON API persisted in this DO's storage.
// The UI is a React app (src/client.tsx) served from public/index.html.
type Note = { id: number; text: string; done: boolean };

export class App extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/api/notes") {
      return new Response("Not found", { status: 404 });
    }
    const notes = ((await this.ctx.storage.get("notes")) as Note[]) ?? [];
    if (request.method === "POST") {
      const body = (await request.json()) as { text: string };
      notes.push({ id: Date.now(), text: body.text, done: false });
      await this.ctx.storage.put("notes", notes);
      return Response.json(notes);
    }
    if (request.method === "PATCH") {
      const id = Number(url.searchParams.get("id"));
      const next = notes.map((n) => (n.id === id ? { ...n, done: !n.done } : n));
      await this.ctx.storage.put("notes", next);
      return Response.json(next);
    }
    if (request.method === "DELETE") {
      const id = Number(url.searchParams.get("id"));
      const next = notes.filter((n) => n.id !== id);
      await this.ctx.storage.put("notes", next);
      return Response.json(next);
    }
    return Response.json(notes);
  }
}
