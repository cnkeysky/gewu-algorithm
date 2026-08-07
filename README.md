# gewu-algorithm

> Build algorithmic thinking through deliberate practice and cognitive frameworks.

`gewu-algorithm` is an open-source platform for deliberate algorithm practice inspired by the [Project-GEWU](https://github.com/cnkeysky/Project-GEWU) learning philosophy.

Instead of treating a solved problem or a memorized implementation as the end of learning, the project helps learners move through a progressive cycle:

```text
Position and Problem
        ->
Current Understanding
        ->
Implementation and Execution Flow
        ->
Reasoning and Pattern
        ->
Transfer and Counterexamples
        ->
Validation, Revision, and Review
```

## Status

The project is at an **internal v0.1.5** level. The Rust Core, the Web
workbench (authoring and practice), and the VS Code adapter are implemented and
covered by automated tests. Template authoring uses staged LLM generation with
deterministic contract validation and a reviewed publication gate.

No claim is currently made that this practice method improves long-term learning outcomes. The project will treat that as a question to be tested through real usage and measurable review results.

## Getting Started

### Prerequisites

- Rust stable (see [`rust-toolchain.toml`](rust-toolchain.toml))
- Node.js 22+ and npm
- Python 3 (used by generated-source compile checks)

### Run the test suites

```sh
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cd tools/template-authoring && npm ci && npm test
cd tools/template-authoring/workbench && npm ci && npm run build
cd editors/vscode && npm ci && npm test
```

### Run the web workbench

Choose one of the two options below.

#### Option A — one command (recommended)

Run `npm run dev` in a terminal. It opens an action menu:

- `1) Start` — ensure core, API, and web are running (starts only what is missing)
- `2) Stop` — stop all managed services
- `3) Status` — show which services are running and healthy
- `4) Prepare` — install dependencies, build the core, configure the LLM provider
- `5) Restart` — stop everything, then start again
- `0) Exit` — quit the menu

Choose `1) Start` (or run `npm run dev:start` directly) to start the stack.
The start flow walks through the setup step by step; existing values are shown
first and you can keep or change them:

1. LLM configuration — confirms the current provider/model, or asks for a new
   provider and a model id you prepared.
2. Ports — confirms `core` / `api` / `web` ports (defaults 4175 / 4174 / 5173),
   or lets you enter new ones.
3. Checks prerequisites (`node`, `npm`, `cargo`, `python3`, `git`).
4. Installs npm dependencies (`npm ci` in `tools/template-authoring` and its
   `workbench`) after asking for confirmation when a slow install is needed.
5. Builds the Rust core (`cargo build -p gewu-cli`).
6. Copies `tools/template-authoring/.env.example` to `.env.local`, then reads
   the API key with hidden input, just before services start.
7. Starts core + authoring API + web client, waits for each health check,
   prints the URLs, and exits; services keep running in the background (logs
   and pid files under `.gewu-dev/`).

To stop, run `npm run dev` again and choose `2) Stop`, or use `npm run
dev:stop`; `npm run dev:status` shows what is running. `start` checks for
existing services and only starts the ones that are missing.

##### Non-interactive runs

CI or piped input skips the prompts and uses the current configuration, flags,
and environment variables:

```sh
# POSIX (Linux, macOS, WSL): set the variable first, then run
export DEEPSEEK_API_KEY=sk-...
npm run dev:prepare -- --provider deepseek --model deepseek-v4-flash

# ...or as a one-line shorthand scoped to that single command
DEEPSEEK_API_KEY=sk-... npm run dev:prepare -- --provider deepseek --model deepseek-v4-flash

# Windows PowerShell
$env:DEEPSEEK_API_KEY = "sk-..."
npm run dev:prepare -- --provider deepseek --model deepseek-v4-flash

# Windows cmd
set DEEPSEEK_API_KEY=sk-...
npm run dev:prepare -- --provider deepseek --model deepseek-v4-flash
```

Omit the key to fall back to the hidden interactive prompt (works on every
platform): `npm run dev:prepare -- --provider deepseek --model deepseek-v4-flash`.
The `sk-...` above is a placeholder; for a real key, prefer the hidden prompt so
the key is not recorded in shell history.

Ports can also be preset with flags on any command, for example:
`npm run dev:start -- --core-port 4175 --api-port 4174 --web-port 5173`
(environment variables `GEWU_CORE_PORT`, `GEWU_WORKBENCH_PORT`, and
`GEWU_WEB_PORT` work the same way).

The runner is one cross-platform Node script (`scripts/gewu-dev.mjs`), so
Linux, macOS, and Windows behave the same. `npm run dev` is the uniform entry
on every platform; other commands are `npm run dev:start`, `npm run
dev:prepare`, `npm run dev:stop`, `npm run dev:restart`, and `npm run
dev:status`. Flags can also be passed directly as
`node scripts/gewu-dev.mjs start --core-port 4175`.

Security: API keys are read from the hidden interactive prompt or from the
provider key environment variable (e.g. `DEEPSEEK_API_KEY`), never from CLI
arguments, and are stored only in the git-ignored `.env.local` (mode 600 on
POSIX). Keys are not echoed or written to the dev logs.

#### Option B — manual three terminals

Start three processes (each in its own terminal):

```sh
# 1. Rust Core on http://127.0.0.1:4175
cd tools/template-authoring && npm run workbench:core

# 2. Authoring API on http://127.0.0.1:4174
cd tools/template-authoring
cp .env.example .env.local   # then set DEEPSEEK_API_KEY (selection keys stay in .env.example)
npm run workbench:api:local

# 3. Vite client at http://127.0.0.1:5173
cd tools/template-authoring/workbench && npm run dev
```

Ports can be overridden with `GEWU_WORKBENCH_PORT` (authoring API),
`GEWU_CORE_PORT` (Core), and the Vite proxy targets `GEWU_AUTHORING_TARGET` /
`GEWU_CORE_TARGET`.

### Run the VS Code extension

Open `editors/vscode` in VS Code and press `F5`. The extension spawns the Rust
Core through `cargo`, so `cargo` must be on `PATH`.

### Run the end-to-end tests

```sh
cd tools/template-authoring/workbench
npx playwright install chromium   # once per machine
npm run test:e2e                  # auto-starts a fresh Core and Vite
```

## Releases

- [`CHANGELOG.md`](CHANGELOG.md) tracks versions and compatibility notes.
- `v0.1.0` (internal trial) is tagged; its execution record, audit notes, and
  artifact checksums are in
  [`docs/development/release-v0.1.0.md`](docs/development/release-v0.1.0.md).
- `v0.1.1` (tooling/CI/security patch) is tagged; see
  [`docs/development/release-v0.1.1.md`](docs/development/release-v0.1.1.md).
- `v0.1.2` (dev runner, CI, web UI, docs patch) is tagged; see
  [`docs/development/release-v0.1.2.md`](docs/development/release-v0.1.2.md).
- `v0.1.3` (dev runner flow and cross-platform fixes) is tagged; see
  [`docs/development/release-v0.1.3.md`](docs/development/release-v0.1.3.md).
- `v0.1.4` (web workbench UI polish) is tagged; see
  [`docs/development/release-v0.1.4.md`](docs/development/release-v0.1.4.md).
- `v0.1.5` (review workflow and filtering) is tagged; see
  [`docs/development/release-v0.1.5.md`](docs/development/release-v0.1.5.md).
- CI runs Rust gates, TypeScript/Web/VS Code tests, and Playwright e2e on every
  push and pull request, and smoke-tests the one-command dev runner on Linux,
  macOS, and Windows (see [`.github/workflows/ci.yml`](.github/workflows/ci.yml)).
  Documentation-only changes (markdown or `docs/`) skip the pipeline; use
  `workflow_dispatch` to force a run.

## Project Boundaries

- **Project-GEWU** defines the general learning philosophy, evidence principles, and cognitive framework practice.
- **gewu-algorithm** implements those ideas for algorithm learning and deliberate practice.
- The Rust core owns deterministic domain and practice logic.
- Editor extensions own presentation and editor integration.
- LLMs may generate drafts and analysis, but are not a source of truth.
- Personal practice records, API keys, and unreviewed generated content remain local by default.

## Current Scope

The local MVP provides:

- a Rust Core with all five practice modes and versioned local persistence;
- a Vite Web workbench with authoring (staged template generation, review,
  publishing) and practice surfaces;
- a VS Code adapter as the first complete editor integration;
- deterministic scoring, checkpoints, attempts, and review recommendations.

Zed integration remains a later compatibility target because its extension surface does not yet provide all interaction capabilities needed by the planned practice experience.

## Repository Layout

```text
gewu-algorithm/
├── crates/          # Rust domain, template, practice, protocol, storage, and core crates
├── apps/            # CLI and stdio core host
├── editors/         # VS Code and future editor adapters
├── schemas/         # Versioned public data schemas
├── packs/           # Built-in content packs during the pre-v1 phase
├── fixtures/        # Test and design fixtures
├── docs/            # Product, architecture, development, and ADR documentation
└── tests/           # Cross-component and compatibility tests
```

Directories are introduced as implementation begins. The intended architecture is documented in [docs/architecture/overview.md](docs/architecture/overview.md).

## Documentation

- [Product vision](docs/product/vision.md)
- [Requirements](docs/product/requirements.md)
- [MVP scope](docs/product/mvp.md)
- [Domain terminology](docs/architecture/terminology.md)
- [Architecture overview](docs/architecture/overview.md)
- [Local protocol](docs/architecture/protocol.md)
- [Local persistence](docs/architecture/persistence.md)
- [Domain model](docs/architecture/domain-model.md)
- [Template system](docs/architecture/template-system.md)
- [Coding standards](docs/development/coding-standards.md)
- [Testing strategy](docs/development/testing.md)
- [Architecture decisions](docs/decisions/README.md)
- [Roadmap](docs/roadmap.md)

## Contributing

The v0.1.0 implementation provides a Rust core with five practice modes
(shadow typing, flow recall, code recall with four layouts, reasoning recall,
and transfer practice), versioned local persistence, a Vite web workbench
(authoring and practice), and a VS Code adapter. Extension-host, IME, and
packaged-binary verification remain manual release checks. Before
contributing, read [CONTRIBUTING.md](CONTRIBUTING.md) and the relevant
architecture decision records. Changes to public schemas, the core protocol,
practice scoring, or template semantics require an ADR and compatibility
analysis.

## License

The project is licensed under the [MIT License](LICENSE). Third-party problem statements, solutions, datasets, and user-created practice records are not automatically covered by this license; see [NOTICE.md](NOTICE.md).
