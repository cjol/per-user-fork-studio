# react-notes-forkable

A forkable worker whose base app is a **React** app with real npm
dependencies — demonstrating that fork rebuilds go through worker-bundler's
full esbuild path: `react`/`react-dom` are fetched from the npm registry and
bundled inside the host Durable Object, and `src/client.tsx` is bundled for
the browser (served at `/client.js`, JSX runtime automatic).

Layout of the seed (`app/`):

- `src/index.ts` — server Durable Object exposing `/api/notes`
- `src/client.tsx` — React UI, bundled per fork
- `public/index.html` — static shell (assets under `public/` are served as-is)
- `AGENT.md` — structure hints for the edit agent

```bash
npm install            # from the repo root (workspaces)
npm run build -w vite-plugin-forkable-worker
npm run dev -w example-react-notes-forkable
```

Note: dependency installs run inside the Durable Object isolate on every cold
rebuild. Two small deps are fine; for heavier stacks, implement an
`AppBundler` that persists installs with worker-bundler's
`DurableObjectKVFileSystem`.
