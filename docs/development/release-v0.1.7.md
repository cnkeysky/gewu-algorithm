# v0.1.7 Release Record

Patch release on 2026-08-08: a dedicated focused practice workspace, simpler
pagination, and web/Rust robustness fixes. The Rust core changed (HTTP server
survives client disconnects), so binary checksums differ from v0.1.6 for
`gewu`; `pack` and `validate` are unchanged. The JSON-RPC protocol stays v2.

## Changes since v0.1.6

- Active practice enters a focus mode: the start controls and the
  Interrupted/Spaced review/Recent attempts panels hide so the problem and
  editor fill the workspace, with a "Back to workspace" button to return while
  the session stays active. The focused workspace is a dedicated layout: a
  full-width toolbar (title, status, Back, Stop) on top, then the problem and
  editor at equal height with a draggable divider (LeetCode-style), filling
  the viewport without page scroll.
- The practice workspace and the focused session workspace are two separate
  views instead of one shared layout: the start page never shows editor-area
  elements, and `hidden`/`display` attribute conflicts are gone (the divider
  no longer overlaps the editor or action buttons). Starting the same
  unit/mode/variant resumes the session in place; a different selection stops
  the old session and starts the new one.
- Pagination is simplified to numbered buttons with ellipsis plus previous/
  next; the standalone go-to-page input is removed and the count reads
  `1–6 of 24` without the "Showing" prefix. The practice variant selector
  keeps its selection when lists refresh.
- Internal identifiers no longer surface in the UI: practice variant labels
  drop the unit prefix, the session context shows `mode · variant`, and the
  home terminal unit comes from the practice catalog.
- The Rust HTTP core no longer exits when a client disconnects mid-request
  (`broken pipe`): per-connection failures are logged and the server keeps
  serving. This removes the flaky "core host failed" exit that broke the
  Playwright e2e suite partway through in CI.
- The focused session view starts directly below the top bar (the shared
  shell's top padding is cleared in focus mode), and the code editor shell
  respects its hidden state again so answer-based modes show no phantom
  editor box.

## Checklist Status

- Gates: Rust workspace tests, TypeScript/Web/VS Code, and Playwright e2e pass
  locally (34 auto tests, 9 existing-mode UI tests); CI is fully green on the
  release commit.
- Audits: unchanged since v0.1.6 (`cargo-audit` 0 vulnerabilities; npm audit
  0/0/0).
- Binaries: Linux x86_64 release build; VSIX packaged
  (`gewu-algorithm-0.1.7.vsix`, 41 files).

## Checksums (SHA-256)

```text
06d7aad445123c37fe6ce0853710b6b4ee6a98ba00bb01d55233ec3243529ce7  gewu-algorithm-0.1.7.vsix
e2c47b5f1ae99feb3a501c333910cc39625194d80113b7220421e80f04a0aa07  gewu (linux x86_64)
b6ea67380e0f0ba3c132776a7167839a4eb8d6fbc6384cdf270f0a7fb6cf441f  pack (linux x86_64)
196af4fa23d464f3cf6d5f92b0bad954a7df41fbf71f1ecb4e09b22caf3f6cce  validate (linux x86_64)
```
