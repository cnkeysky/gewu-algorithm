# v0.1.2 Release Record

Patch release on 2026-08-07: dev runner, CI, web UI, and documentation.
No protocol, schema, or practice-mode behavior changes since v0.1.1.

## Changes since v0.1.1

- Dev runner: services run in the background and the script exits after
  starting them; a no-argument action menu (`1` start, `2` stop, `3` status,
  `4` prepare, `5` restart, `0` exit) with one-line descriptions; `start`
  probes existing services and only starts missing ones; new `status` /
  `npm run dev:status`.
- `dev:stop` terminates every process listening on the configured ports
  (leftover grandchildren from older script versions and external processes
  included), with a SIGKILL fallback after a grace period.
- Cross-platform: `cargo.exe` is resolved on Windows; CI smoke-tests the dev
  runner on Linux, macOS, and Windows.
- Web workbench: all paginated lists show an entry range, current page, and a
  jump-to-page input; Drafts pagination is pinned; draft workflow labels use
  `›` separators.
- Documentation: pagination details moved to the workbench README; root README
  reflects the current release.

## Checklist Status

- Gates: `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D
  warnings` (0), `cargo test --workspace`, TypeScript tests, Web build, VS Code
  adapter tests, Playwright e2e (19) all pass.
- Audits: `cargo-audit` 0 vulnerabilities (see v0.1.0/0.1.1 records); npm audit
  0/0/0 with the documented DOMPurify mitigation.
- Binaries: Linux x86_64 release build; VSIX packaged
  (`gewu-algorithm-0.1.2.vsix`, 41 files). Rust binaries are unchanged since
  v0.1.1 (same checksums).

## Checksums (SHA-256)

```text
e196593afec6834c397277bc47d0f3ccf91b01898b25ce86ce0da9b733083fae  gewu-algorithm-0.1.2.vsix
eca79229ee482a5c715813a79fbd21f8b2e8dfaf80f049506f493ebb416cecf1  gewu (linux x86_64)
b6ea67380e0f0ba3c132776a7167839a4eb8d6fbc6384cdf270f0a7fb6cf441f  pack (linux x86_64)
196af4fa23d464f3cf6d5f92b0bad954a7df41fbf71f1ecb4e09b22caf3f6cce  validate (linux x86_64)
```
