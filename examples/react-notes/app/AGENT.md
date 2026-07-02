This app has three parts:

- src/index.ts — the server: a Durable Object exposing the /api/notes JSON API
  persisted in this.ctx.storage.
- src/client.tsx — the UI: a React app (JSX runtime is automatic — no React
  import needed for JSX). It is bundled and served at /client.js.
- public/index.html — the static shell that loads /client.js and holds the CSS.

React and react-dom are already available. Keep UI changes in client.tsx and
index.html; keep data/API changes in index.ts.
