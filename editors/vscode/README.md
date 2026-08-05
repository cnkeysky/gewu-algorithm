# VS Code Local MVP Client

This package is the Stage 3 local `cnkeysky.gewu-algorithm` client. It launches the Rust `gewu` stdio host, performs a versioned handshake, renders Rust-owned Shadow Typing state in a dedicated untitled document, and hosts ordered Flow Recall in a structured Webview panel. Local attempt history and selectable checkpoint recovery remain core-backed and offline; only one practice UI is active at a time.

Requirements are the system-provided Node.js `v24.15.0` and npm `11.17.0`. Install the locked development dependencies and run:

```text
npm install
npm run format
npm run lint
npm run typecheck
npm test
```

`src/core-client.ts` owns core-process lifecycle and validates JSON-RPC frames. `src/core-session.ts` translates native editor transactions but does not score them. `src/interaction.ts` retains the host-transaction normalization utilities and Stage 2 regression tests. Real VS Code, format-on-save, snippets/completions, and IME behavior remain on the [manual checklist](../../docs/development/vscode-spike-checklist.md).

Open the repository root in VS Code, run `Run GEWU Local MVP`, then invoke `GEWU: Start Shadow Typing` or `GEWU: Start Flow Recall`. Select one of the repository's validated local fixtures. The F5 launch is a host verification entry point, not an automated integration test.
