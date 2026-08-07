# v0.1.3 Release Record

Patch release on 2026-08-07: dev runner flow, cross-platform fixes, CI.
No protocol, schema, or practice-mode behavior changes since v0.1.2.

## Changes since v0.1.2

- `npm run dev` opens the action menu (a bare `node scripts/gewu-dev.mjs`);
  direct start moved to `npm run dev:start`. Root package version is kept in
  sync with releases.
- Choosing `1) Start` (or `dev:start`) guides through LLM configuration (keep
  or change) and ports (keep or change) before installing, building, reading
  the API key, and starting services. Non-interactive runs keep the current
  configuration and flags.
- Windows non-interactive runs work: `npm.cmd` is probed through the shell,
  and prerequisites are checked before any prompt.
- CI smoke-tests the dev runner on Linux, macOS, and Windows; all jobs green.

## Checklist Status

- Gates: Rust gates, TypeScript/Web/VS Code, Playwright e2e (19), and the
  three-platform dev-runner smoke all pass on CI.
- Audits: `cargo-audit` 0 vulnerabilities; npm audit 0/0/0 (DOMPurify note as
  documented in v0.1.0).
- Binaries: Linux x86_64 release build; VSIX packaged
  (`gewu-algorithm-0.1.3.vsix`, 41 files). Rust binaries unchanged since
  v0.1.1 (same checksums).

## Checksums (SHA-256)

```text
83a67103d22af9fe61581dd649c70c58e05085f5bf441254ad0096beecd47f06  gewu-algorithm-0.1.3.vsix
eca79229ee482a5c715813a79fbd21f8b2e8dfaf80f049506f493ebb416cecf1  gewu (linux x86_64)
b6ea67380e0f0ba3c132776a7167839a4eb8d6fbc6384cdf270f0a7fb6cf441f  pack (linux x86_64)
196af4fa23d464f3cf6d5f92b0bad954a7df41fbf71f1ecb4e09b22caf3f6cce  validate (linux x86_64)
```
