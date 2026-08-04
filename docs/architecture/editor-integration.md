# Editor Integration

## Editor Responsibility

An editor client owns:

- commands and activation;
- core process lifecycle;
- translation of editor changes into protocol events;
- decorations and status display;
- local settings and secret-storage integration;
- accessible user feedback;
- editor-specific integration tests.

It does not own template validation, scoring, review rules, or LLM prompt semantics.

## VS Code

TypeScript is the primary implementation language for the VS Code extension. The interaction design must be selected through an explicit technical spike:

1. native text editor plus decorations;
2. controlled virtual or custom document;
3. Webview only when required for reliable behavior.

The Stage 2 spike compares the three options and selects a native text editor plus decorations backed by a dedicated untitled practice document. Leading indentation is practiced incrementally using the editor's ordinary Tab width before the current-line ghost text is revealed. See [the spike report](vscode-interaction-spike.md) and [ADR 0007](../decisions/0007-vscode-native-practice-document.md). The implementation defines behavior for paste, multi-cursor, Undo/Redo, formatting, completion providers, snippets, Tab, input methods, line endings, and external mutations. IME composition remains a manual real-host check until a reliable VS Code automation boundary is established.

The Stage 3 development extension launches the local `gewu` CLI through Cargo, performs a protocol handshake before enabling practice commands, and uses repository fixtures as local content. Packaged native binary selection remains a release-packaging task. The extension translates editor events and renders core-returned state; it does not score sessions or write persistence files.

## Zed

Zed remains a planned adapter, not an MVP dependency. Its implementation must use stable public extension capabilities available at development time. Core architecture must not be weakened to simulate UI features that Zed cannot expose.

Possible early integrations include commands, an external CLI workflow, or MCP-based content assistance. Full Shadow Typing should be attempted only when editor-event and UI APIs can support the same reliability contract as VS Code.

## Web and Remote Environments

The native-binary design does not automatically support browser-only VS Code. A future browser client may use a WebAssembly core subset or remote service, but that requires a separate privacy and deployment decision.
