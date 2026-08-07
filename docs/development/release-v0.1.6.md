# v0.1.6 Release Record

Patch release on 2026-08-07: editor robustness, reduced disk pressure, and
review scheduling cleanup. The Rust core changed (review scheduling and
checkpoint throttling), so binary checksums differ from v0.1.5. The JSON-RPC
protocol stays v2.

## Changes since v0.1.5

- Shadow typing / code recall Enter is anchored to the accepted boundary and
  validated locally against the target: Enter only acts when a newline is
  actually expected, so held/repeated Enter is ignored instead of being
  rejected and rolled back. The code editor auto-activates on start/resume so
  Enter works without a click.
- Editors enqueue every content change instead of batching: a wrong character
  is rejected on its own while the correctly typed prefix stays accepted; a
  large wrong paste remains one atomic rejection. The guidance ghost repaints
  immediately on deletions and keeps showing the correct hint while a wrong
  character is pending.
- Core writes recovery checkpoints at most once per 1.5s per session; the
  workbench forces a final checkpoint on page unload, so recovery granularity
  is unchanged while typing stays off the disk.
- Spaced review only schedules material completed at least once; the
  `Inconclusive` recommendation kind is removed.
- Draft action buttons and practice start/stop ignore rapid repeated clicks.

## Checklist Status

- Gates: Rust workspace tests, TypeScript/Web/VS Code, and Playwright e2e pass
  locally (31 auto tests, 9 existing-mode UI tests).
- Audits: unchanged since v0.1.5 (`cargo-audit` 0 vulnerabilities; npm audit
  0/0/0).
- Binaries: Linux x86_64 release build; VSIX packaged
  (`gewu-algorithm-0.1.6.vsix`, 41 files).

## Checksums (SHA-256)

```text
669179063249c6797954b56b1a863101412052494031c03e85f2213cb995f0bd  gewu-algorithm-0.1.6.vsix
aba1333b4011cc17574bdc52d38fedcb68cdb61e8d29fe6349e1be9700f90c07  gewu (linux x86_64)
b6ea67380e0f0ba3c132776a7167839a4eb8d6fbc6384cdf270f0a7fb6cf441f  pack (linux x86_64)
196af4fa23d464f3cf6d5f92b0bad954a7df41fbf71f1ecb4e09b22caf3f6cce  validate (linux x86_64)
```
