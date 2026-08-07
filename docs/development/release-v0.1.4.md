# v0.1.4 Release Record

Patch release on 2026-08-07: web workbench UI polish, draft deletion, and UI
test coverage. No protocol, schema, or practice-mode behavior changes since
v0.1.3; the Rust binaries are byte-identical to v0.1.3.

## Changes since v0.1.3

- Drafts: unpublished drafts can be deleted from the row actions with cascading
  cleanup of the artifact directory and review reports (`DELETE
  /api/drafts/:id`); accepted (published) drafts stay immutable. Deletion uses
  a custom confirm dialog instead of `window.confirm`.
- Pagination redesigned across Drafts and the practice lists (Interrupted,
  Spaced review, Recent attempts): hidden when everything fits on one page,
  numbered page buttons with previous/next, and a go-to-page input (Enter to
  jump) only when there are many pages.
- Drafts list uses a fixed-height area sized to exactly six measured rows (no
  inner scrollbar), so page content changes no longer move the page.
- Practice workspace: unit/mode/variant controls span the full width; the
  problem statement and the live session sit side by side (LeetCode-style) and
  stack below 940px. The problem pane appears only after a practice starts and
  fills the column height above the side panels.
- Session header now carries the live status line and the Stop action; the
  editor's bottom edge aligns with the problem pane. The status line reports
  progress as a percentage without repeating the mode label, and the recovery
  checkpoint of the currently active session is marked "in progress" in the
  Interrupted list instead of looking like a separate interruption.
- Side panels form one padded card with symmetric column spacing; records show
  title, mode/variant, and progress on separate lines with comfortable gaps and
  two-line titles.
- Workspace shell widened to 1360px and the practice view matches the 29px
  horizontal inset used by the other pages.
- The workbench dev server watches files with polling so WSL2 and
  atomic-save editors pick up changes immediately instead of serving stale
  modules to the browser tab.

## Checklist Status

- Gates: Rust gates, TypeScript/Web/VS Code, and Playwright e2e pass locally
  (23 auto tests, 5 existing-mode UI tests). CI runs the same gates on push.
- Audits: unchanged since v0.1.3 (`cargo-audit` 0 vulnerabilities; npm audit
  0/0/0).
- Binaries: Linux x86_64 release build is byte-identical to v0.1.3 (same
  checksums); VSIX packaged (`gewu-algorithm-0.1.4.vsix`, 41 files).

## Checksums (SHA-256)

```text
8153921e25edc3c76d833fd064fabf68a3f652735437f4b7d2564f518a0fa3c7  gewu-algorithm-0.1.4.vsix
eca79229ee482a5c715813a79fbd21f8b2e8dfaf80f049506f493ebb416cecf1  gewu (linux x86_64)
b6ea67380e0f0ba3c132776a7167839a4eb8d6fbc6384cdf270f0a7fb6cf441f  pack (linux x86_64)
196af4fa23d464f3cf6d5f92b0bad954a7df41fbf71f1ecb4e09b22caf3f6cce  validate (linux x86_64)
```
