# Changelog

All notable changes are documented here. Before `1.0`, incompatible changes are
allowed only with explicit migration notes (see
[`docs/development/release.md`](docs/development/release.md)).

## [Unreleased]

### Added

- One-command development stack: a single cross-platform Node runner
  (`scripts/gewu-dev.mjs`) exposed through root npm scripts (`npm run dev`,
  `dev:prepare`, `dev:stop`, `dev:restart`) installs dependencies, builds the
  core, and walks through provider/model selection with a hidden API-key
  prompt or the provider key environment variable (never a CLI argument), then
  starts core + authoring API + web client with configurable ports and process
  cleanup on Linux, macOS, and Windows. The setup is guided step by step
  (prerequisites, dependencies, core build, LLM provider wizard, services),
  confirms before slow installs, confirms ports before starting, and stops on
  Enter/Ctrl+C or `npm run dev:stop`. Model info is expected to be prepared by
  the user up front, and the API key is read after the install/build steps so
  it is not held across long-running work and never appears in process
  arguments, shell history, or dev logs.
- `cargo-audit` gate in the Rust CI job.

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
