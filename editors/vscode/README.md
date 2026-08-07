# VS Code Local MVP Client

This package is the VS Code adapter for the `cnkeysky.gewu-algorithm` core. It launches the Rust `gewu` stdio host, performs a versioned handshake, and drives Shadow Typing, Code Recall (including structured layouts), and Flow Recall sessions with core-backed scoring, local attempt history, and selectable checkpoint recovery. Only one practice UI is active at a time.

Requirements are the system-provided Node.js `v24.15.0` and npm `11.17.0`. Install the locked development dependencies and run:

```text
npm install
npm run format
npm run lint
npm run typecheck
npm test
```

`src/core-client.ts` owns core-process lifecycle and validates JSON-RPC frames. `src/core-session.ts` translates native editor transactions but does not score them. `src/interaction.ts` retains the host-transaction normalization utilities and Stage 2 regression tests. Real VS Code, format-on-save, snippets/completions, and IME behavior remain on the [manual checklist](../../docs/development/vscode-spike-checklist.md).

Open the repository root in VS Code, run the F5 launch task, then invoke
`GEWU: Start Shadow Typing`, `GEWU: Start Code Recall`, or
`GEWU: Start Flow Recall`. Select one of the repository's validated local
fixtures or a published unit served by the Core. The F5 launch is a host
verification entry point, not an automated integration test.
