This app is a SINGLE file: src/index.ts. Its async fetch() server-renders an
HTML dashboard (see the page() helper: plain HTML string + inline vanilla JS in
CLIENT_JS) and a JSON API persisted in this.ctx.storage (KV-style get/put).

The UI is plain HTML + inline JS — do NOT add React or any framework.
