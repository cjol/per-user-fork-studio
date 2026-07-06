# todo-forkable

The prototype's dashboard app, packaged as a forkable worker via
[`vite-plugin-forkable-worker`](../../packages/vite-plugin-forkable-worker).

- `app/` is the seed every visitor forks: a single-file Durable Object app
  plus `AGENT.md` instructions for the edit agent.
- The host entry is generated at `.forkable/entry.ts` (gitignored);
  `wrangler.jsonc` points `main` at it and declares the bindings the harness
  needs.

```bash
npm install            # from the repo root (workspaces)
npm run build -w vite-plugin-forkable-worker
npm run dev -w example-todo-forkable      # or: npm run deploy -w example-todo-forkable
```

The Artifacts binding runs remotely (`"remote": true`), so dev needs a logged
in wrangler with access to an account that has Artifacts enabled.
