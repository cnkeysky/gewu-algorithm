# Changelog

All notable changes are documented here. Before `1.0`, incompatible changes are
allowed only with explicit migration notes (see
[`docs/development/release.md`](docs/development/release.md)).

## [Unreleased]

### Changed

- Dev runner services now run in the background and the script exits after
  starting them. Running the script without a command opens an action menu
  (`1` start, `2` stop, `3` status, `4` prepare, `5` restart, `0` exit);
  `start` probes existing services and only starts the missing ones; a new
  `dev:status` script shows what is running and healthy.

## [0.1.1] - 2026-08-07

Tooling, CI, and security release. No protocol, schema, or practice-mode
behavior changes since v0.1.0.

### Added

- One-command development stack: a single cross-platform Node runner
  (`scripts/gewu-dev.mjs`) exposed through root npm scripts (`npm run dev`,
  `dev:prepare`, `dev:stop`, `dev:restart`) installs dependencies, builds the
  core, and starts core + authoring API + web client with configurable ports
  and process cleanup on Linux, macOS, and Windows. The setup is guided step by
  step (prerequisites, dependencies, core build, LLM provider/model wizard,
  services), confirms before slow installs, confirms ports before starting,
  and stops on Enter/Ctrl+C or `npm run dev:stop`.
- `cargo-audit` gate in the Rust CI job.

### Changed

- Model info is prepared by the user up front; the API key is read after the
  install/build steps so it is not held across long-running work.
- GitHub Actions upgraded to v5; Playwright e2e runs with retries and larger
  timeouts, and the e2e specs were made deterministic.

### Security

- API keys are never accepted as CLI arguments. They are read from the hidden
  interactive prompt or the provider key environment variable, stored only in
  the git-ignored `.env.local` (mode 600 on POSIX), and never echoed or logged.

### Docs

- README quickstart now offers Option A (one-command, with a full walkthrough)
  and Option B (manual three terminals); release records and checksums live in
  `docs/development/release-v0.1.1.md`.

## [0.1.0] - 2026-08-07

Initial internal delivery of the deliberate algorithm practice platform.

### Added

- Rust Core with five practice modes: shadow typing, flow recall, code recall
  (`full_recall`, `comment_guided`, `comment_to_code`, `cloze`), reasoning
  recall, and transfer practice.
- Deterministic practice semantics: replayable events, versioned checkpoints,
  immutable terminal attempts, restart/stop/resume, and review
  recommendations with Ebbinghaus-style scheduling.
- JSON-RPC v2 protocol with golden handshake tests; stdio and HTTP hosts.
- Template authoring pipeline: `AlgorithmUnit` schema v2, staged LLM generation
  (core, per code recall layout, reasoning, transfer) with an error-feedback
  repair loop, deterministic source-template derivation, and Rust contract
  validation.
- Three-role LLM pre-review (correctness, learning design, provenance/safety)
  with a documented human-override accept path.
- Immutable accepted revisions with a fork/new-revision flow and monotonic
  publishing; content pack `build`/`verify` commands.
- Vite web workbench (home, authoring, practice) and a Monaco-based shadow
  editor; the dev Core serves fixtures plus published units through multiple
  content roots.
- VS Code adapter with core-backed shadow typing, code recall, flow recall,
  checkpoints, and history commands.
- Continuous integration workflow (Rust gates, TypeScript/Web/VS Code tests,
  Playwright e2e).

### Compatibility

- Protocol v2 and `AlgorithmUnit` schema v2 are the current contracts.
- `reasoning_recall` and `transfer_practice` items may declare an optional
  `implementation` binding; absent means the unit's first implementation.
  This is an additive change to the JSON schema and loaders.
- Generation uses one algorithm-agnostic contract prompt; problem-class prompt
  templates are intentionally not used.
- Secrets stay local: `.env*` files are ignored, and provider keys are read
  from the process environment only.
