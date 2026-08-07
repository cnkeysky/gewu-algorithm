# v0.1.1 Release Record

Patch release on 2026-08-07: tooling, CI, and security only. No protocol,
schema, or practice-mode behavior changes since v0.1.0.

## Changes since v0.1.0

- Cross-platform one-command dev runner (`scripts/gewu-dev.mjs`) with root npm
  scripts (`dev`, `dev:prepare`, `dev:stop`, `dev:restart`); guided step-by-step
  setup (prerequisites, dependencies, core build, LLM provider/model wizard,
  services), port confirmation, and Enter/Ctrl+C/`dev:stop` shutdown.
- LLM setup: model id prepared by the user up front; API key read after the
  install/build steps.
- Security: API keys are never accepted as CLI arguments; they come from the
  hidden prompt or the provider key environment variable and are stored only
  in the git-ignored `.env.local` (mode 600 on POSIX).
- CI: actions/checkout and actions/setup-node v5, Playwright e2e with retries
  and larger timeouts, deterministic e2e specs, and a `cargo-audit` gate
  (0 vulnerabilities across 32 locked crates).
- README quickstart with Option A / Option B and release documentation.

## Checklist Status

- Gates: `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D
  warnings` (0), `cargo test --workspace`, TypeScript tests, Web build, VS Code
  adapter tests (24), Playwright e2e (19) all pass.
- Audits: `cargo-audit` 0 vulnerabilities; npm audit 0/0/0 (workbench
  `dompurify@3.4.13` moderate advisories documented in v0.1.0 with default
  config mitigation).
- Binaries: Linux x86_64 release build (checksums below); VSIX packaged
  (`gewu-algorithm-0.1.1.vsix`, 41 files).
- Offline practice, credential redaction, and local-data deletion verified as
  in v0.1.0; upgrade path not applicable (patch on the same contracts).

## Checksums (SHA-256)

```text
6ce9977dde1584b0c3dfd0fd2d827c73d79f18954aa92b8eb75ef0c2530889cd  gewu-algorithm-0.1.1.vsix
eca79229ee482a5c715813a79fbd21f8b2e8dfaf80f049506f493ebb416cecf1  gewu (linux x86_64)
b6ea67380e0f0ba3c132776a7167839a4eb8d6fbc6384cdf270f0a7fb6cf441f  pack (linux x86_64)
196af4fa23d464f3cf6d5f92b0bad954a7df41fbf71f1ecb4e09b22caf3f6cce  validate (linux x86_64)
```
