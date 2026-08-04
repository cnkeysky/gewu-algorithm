# VS Code Interaction Spike

This package is the Stage 2 technical spike and a minimal runnable `cnkeysky.gewu-algorithm` extension. It validates transaction policy and lifecycle ownership but does not launch the Rust core, persist attempts, or provide the complete product workflow.

Requirements are the system-provided Node.js `v24.15.0` and npm `11.17.0`. Install the locked development dependencies and run:

```text
npm install
npm run format
npm run lint
npm run typecheck
npm test
```

The pure boundary is in `src/interaction.ts`; tests use a small fake host in `test/interaction.ts`. Real VS Code, format-on-save, snippets/completions, and IME behavior remain on the [manual checklist](../../docs/development/vscode-spike-checklist.md).

Open the repository root in VS Code, run the `Run GEWU Interaction Spike` launch configuration, and execute `GEWU: Start Shadow Typing (Spike)` from the Command Palette. The current selection becomes the target; with no selection, a short built-in sample is used. The F5 launch is a host verification entry point, not an automated integration test.
