# v0.1.5 Release Record

Patch release on 2026-08-07: review workflow, artifact inspection, filters, and
UX feedback. No protocol, schema, or practice-mode behavior changes since
v0.1.4; the Rust binaries are byte-identical to v0.1.3/v0.1.4.

## Changes since v0.1.4

- Artifact inspection is a modal opened from Drafts or Review history (the
  Review history "View feedback" action works again). The manifest has its own
  full-width taller editor, `.pyc`/`__pycache__` binary files are hidden, and
  LLM pre-review findings render as severity-colored cards with the standard
  "Showing X–Y of Z" pagination inside a fixed-height container.
- Human-edited artifacts can be published directly: saving a revision records a
  `human_revision` pass review and moves the draft to `validated`, where both
  "Human approve" and "LLM pre-review" are offered. Post-edit LLM pre-review
  reports the real outcome instead of always claiming all roles passed.
- `needs_revision` drafts get a prominent "Revise artifact" action and a
  workflow "Open artifact to revise" button; audit trail verdicts are
  color-coded with readable labels; Review history is paginated with a
  fixed-height list and aligned rows.
- Draft actions report through a global toast, refresh the list in place
  (current page and scroll kept), and use deterministic ordering; the
  accepted-draft action is renamed "Extend unit".
- Drafts and Review history gain status/verdict filter pills with live counts
  (Drafts: All / Needs attention / In progress / Published; History: All /
  Pass / Needs revision / Reject), with the pagination strip reserving its
  height so filters never move the layout.
- The workbench dev server polls for file changes so WSL2 and atomic-save
  workflows never serve stale modules.

## Checklist Status

- Gates: Rust gates, TypeScript/Web/VS Code, and Playwright e2e pass locally
  (27 auto tests, 9 existing-mode UI tests). CI runs the same gates on push.
- Audits: unchanged since v0.1.4 (`cargo-audit` 0 vulnerabilities; npm audit
  0/0/0).
- Binaries: Linux x86_64 release build is byte-identical to v0.1.4 (same
  checksums); VSIX packaged (`gewu-algorithm-0.1.5.vsix`, 41 files).

## Checksums (SHA-256)

```text
60025077a8b31b6a476fedcf8f2eb12a1102ee55f601457c5ae8febc6945a259  gewu-algorithm-0.1.5.vsix
eca79229ee482a5c715813a79fbd21f8b2e8dfaf80f049506f493ebb416cecf1  gewu (linux x86_64)
b6ea67380e0f0ba3c132776a7167839a4eb8d6fbc6384cdf270f0a7fb6cf441f  pack (linux x86_64)
196af4fa23d464f3cf6d5f92b0bad954a7df41fbf71f1ecb4e09b22caf3f6cce  validate (linux x86_64)
```
