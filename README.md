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

The project is at an **internal v0.1.9** level. The Rust Core, the Web
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

### Batch template authoring (CLI)

The batch CLI drives the same authoring API as the web workbench, so every
draft stays in the local sqlite store, appears in Drafts / Review history, and
publishes through the normal acceptance gate. It defaults to all five practice
modes — shadow typing, flow recall, code recall, reasoning recall, and
transfer practice — which expand to **8 practice kinds**: shadow typing, flow
recall, the four code recall layouts (full recall, comment guided, comment to
code, cloze), reasoning recall, and transfer practice, plus one shadow typing
item per implementation strategy.

What batch authoring needs: only the **authoring API** (the `npm run batch`
runner starts it automatically when it is down) and the **LLM provider/key**
configured for the authoring API (see the LLM configuration section). The Vite
web client and the Rust Core are **not** required for generation — drafts land
in the same local sqlite store and appear in the web Drafts / Review history
pages whenever the client runs, and the Core is only needed later to practice
the published units.

```sh
npm run batch                      # interactive menu (starts the API if needed)
npm run batch:run -- --problems tools/template-authoring/hot100.json \
  --steps draft,generate,validate,accept
```

**Default approval role**: the LLM acceptance gate is the decisive approver —
with `--steps draft,generate,validate,accept`, the gate reviews the validated
artifact and a pass publishes the unit with the **LLM approved** label, no
human step. Human approval remains the superior upgrade tier, never a
prerequisite. The interactive `npm run batch` runner defaults to exactly these
steps and derives the approver from `.env.local` /
`GEWU_LLM_PROVIDER`/`GEWU_LLM_MODEL`; include `review` in `--steps` to run the
three advisory pre-review roles first.

`npm run batch` mirrors the one-command dev runner: it starts the authoring
API when it is down, asks the batch questions interactively (problems file,
concurrency, repair rounds), runs the batch, and reports. `--auto-accept` is an
explicit operator override and is not part of the interactive default.
Non-interactive flags are supported (`run --problems FILE --steps ...`);
`npm run batch:status` shows API health and the last report, and
`npm run batch:stop` stops the API that the script started. `batch:status`
defaults to the actionable items (failed / needs-review / live non-accepted
drafts) with compact first-line errors; add `--results` for the full per-item
list of the last finished batch. `batch:status` also reports whether a batch
run is still going — **in progress** (pid + heartbeat), **interrupted** (the
run died; leftover drafts are reused), or **not running** (the report below is
the last finished result). `npm run batch:stop` stops the API that the script
started (or any API listening on the remembered port; the API also records its
own pid for this). The raw CLI still lives in
`tools/template-authoring` (`npm run batch -- --problems FILE ...`).
All GEWU services leave pid/port traces in `.gewu-dev/pids`, and both
`dev:stop` and `batch:stop` sweep every port recorded there (not just the dev
stack's three ports), so an API started by the batch runner is stopped by
either command. The authoring API reports a build id on `/api/health`, and the
batch runner restarts a healthy-but-stale API instead of silently reusing old
code. As a final safety net, both stop commands probe every listening
localhost port for the authoring API's `/api/health` signature and stop
orphans even when no pid/port traces survive.
When using a shared relay/proxy gateway, pass `--request-delay-ms` (e.g.
`--request-delay-ms 2000`) to pause between LLM-backed calls and avoid
tripping Cloudflare-style rate/security limits, and prefer
`--concurrency 1` (the default; 2 at most) instead of parallel bursts — a
shared relay blocks IPs that fire many requests at once. 5xx and JSON 403
responses are retried with backoff automatically; HTML 403 security blocks are
not retried, and a failed generation is never blind-retried (retries happen
inside the generator with feedback).

The CLI is problem-agnostic: any algorithm problem text works, not just
LeetCode. Generation uses the provider/model configured on the authoring API:
**built-in providers come from the Pi package** (DeepSeek, OpenAI, Moonshot,
Xiaomi, and everything Pi-ai ships — ids, labels, models, and key env
conventions are Pi's, so vendor changes are handled by updating Pi), and
**relay providers are our OpenAI-compatible extension** declared in
`tools/template-authoring/providers.json` (a key-value mapping
`id -> { label, keyEnv, baseUrlEnv, wireApi, opencodeHeaders }`; add a named
relay there, set its env vars, and point `GEWU_LLM_PROVIDER` at it — no code
changes). The default relay entry speaks the OpenAI Responses API
(`wireApi: "responses"`, what Codex-style gateways expect); chat-only gateways
use `wireApi: "chat"`. LLM transport (relays and Pi built-in providers) honors
`GEWU_LLM_PROXY`, falling back to `HTTPS_PROXY` / `HTTP_PROXY`, or connects
directly when neither is set; `GEWU_LLM_PROXY=off` forces a direct connection
even when proxy env vars are present.
Switch by setting `GEWU_LLM_PROVIDER` / `GEWU_LLM_MODEL` and the matching API
key, then restart the API (or re-run `npm run dev:prepare`).

Duplicate protection is on by default: a problem whose accepted unit already
covers the requested modes is skipped — in an interactive terminal you are
asked first (skip / regenerate this problem / regenerate all remaining
duplicates / quit), so a re-run never silently overwrites your work. Adding
modes to an existing problem forks it and publishes a new revision with the
extended coverage, and `--force` (or `--regenerate <ids>`) regenerates
specific problems as new revisions. `--yes` skips the prompts (the default
when the CLI is not a TTY, e.g. CI). `--select 1,15,two-sum` runs only the
given LeetCode ids / slugs / titles instead of rescanning the whole catalog.
Entries without a problem statement are skipped with a warning. Duplicate
identity is the problem's `slug`/id + language, unified with a statement
fingerprint (a problem matches an existing draft by slug **or** normalized
statement, so cross-catalog slug variants and slug-less web drafts resolve to
the same problem): a template in one language is never treated as a duplicate
of an accepted template in another language, so Python and Java templates for
the same problem coexist as separate units (unit ids are language-qualified,
`<slug>.<language>` — see
[ADR 0019](docs/decisions/0019-language-qualified-unit-identity.md)).
Non-accepted drafts (failed, interrupted, needs-revision) are reused and reset
on re-runs, so repeated runs never accumulate duplicate entries.
Requested-mode coverage then decides the action — fully covered is skipped,
partially covered forks and publishes an extended revision.
**Accepted units are skipped by default**: a published unit whose accepted
revision already covers all requested modes is never regenerated on a re-run;
only an explicit `--force` or `--regenerate <ids>` regenerates it as a new
revision.

`tools/template-authoring/hot100.json` ships the current LeetCode Hot 100
catalog (official study plan, Chinese statements, `language: "python"` on every
entry). That pinned value is only the default: an explicit `--language java`
(or any other slug) overrides it for the whole run, and the batch runner
forwards `--language` whenever it is given explicitly. Refresh the catalog
with `cd tools/template-authoring && npm run fetch:hot100`; the catalog is a
plain list (ids, slugs, titles, statements) — generated units, drafts, and
review history live in sqlite and per-unit directories, so adding more
problems never grows a single JSON file without bound.

Problems file (JSON):

```json
[
  {
    "id": "1",
    "slug": "two-sum",
    "title": "Two Sum",
    "problem": "Given an array of integers nums and an integer target ...",
    "source_url": "https://leetcode.com/problems/two-sum/",
    "language": "python"
  }
]
```

TSV (`title\tproblem\turl`) is also accepted. Useful flags:

- `--steps draft,generate,validate,review,accept` — run a subset. The raw CLI
  defaults to all steps; the interactive `npm run batch` runner defaults to
  `draft,generate,validate,accept` (the LLM gate is the sole reviewer).
- `--select 1,15,two-sum` — run only the given ids / slugs / titles.
- `--force` — regenerate problems even when an accepted unit covers them
  (published as a new revision).
- `--yes` — skip the duplicate prompts (default when the CLI is not a TTY).
- `--repair-rounds n` — after a failed LLM pre-review, regenerate from the
  review feedback up to `n` times (default 1).
- `--max-failures n` — circuit breaker: a draft whose generate/validate
  attempts fail `n` times is quarantined and reported as needs review instead
  of being auto-retried forever (default 3; `--force` / `--regenerate`
  bypass it, and the web workbench's manual retry resets the counter).
- `--regenerate <ids>` — force regeneration for the given ids/slugs/titles as
  new revisions even when their requested modes are already covered.
- `--timeout-minutes n` — per-request timeout for LLM-backed API calls
  (default 60; raise it for slow reasoning-mode relays).
- `--auto-accept` — publish drafts that still need revision after the repair
  rounds, recording an explicit `human_acceptance` rationale in the audit
  trail (LLM pre-review verdicts stay visible in Review history). This is the
  operator (human-tier) override; the `accept` step otherwise runs the LLM
  approval gate by default.
- `--llm-approve provider:model` — run a model-driven final approval gate
  (`llm_acceptance`): the approver model reads the artifact and every LLM
  pre-review finding, returns pass / needs_revision, and on pass the draft is
  published with the approval recorded as **LLM approve** in the audit trail
  (distinct from human approval). The whole batch chain — draft, generation,
  deterministic validation, LLM pre-review, and approval — is LLM-driven.
  Problems may pin their own creator model (`provider` / `model` fields in
  the problems file), so different problems can be dispatched to different
  LLM APIs while a single approver model gates publication.
- `--creator-models deepseek:deepseek-v4-flash,openai:gpt-4.1` — rotate the
  creator model round-robin across problems (per-problem `provider` / `model`
  pins win; without either, all problems use the authoring server's configured
  model).
- `--concurrency n`, `--provider`, `--model`, `--modes`, `--assistance`,
  `--report path`.
- `--variants N` — explicit implementation strategy count. Default is auto:
  the model generates as many genuinely distinct solutions as the problem
  warrants (typically one canonical implementation), never cosmetic variants
  (batch overrides the automatic behavior; the web authoring form always uses
  auto). Shadow typing exposes one item per strategy; the other practice modes
  bind to the canonical implementation.
- `--language <slug>` — global override. Without it each catalog entry's
  `language` applies (hot100.json pins python); catalogs may mix languages by
  giving entries different `language` values, and dedup stays per slug/id +
  language. Generate a non-Python Hot 100 catalog with
  `cd tools/template-authoring && npm run fetch:hot100 -- --language java --out hot100-java.json`.

Published units land in the local content root
(`tools/template-authoring/drafts/.workbench/published` by default) and ship
as a **content pack**: run `npm run units:pack` to regenerate the committed
ledger `units/index.json` (id, language, revision, modes, sha256 — the batch
dedup and audit record) plus a `gewu-units-*.tar.gz`, then
`gh release upload <tag> <tarball>`. A fresh clone runs `npm run units:fetch`
to download and extract the pack for practice; dedup already works from the
committed ledger, so reruns skip published problems without regenerating
duplicates. Each published unit carries its **full review record** — the LLM
pre-review role reports and the acceptance gate report under `reviews/`, plus
`reviews/summary.json` (acceptance rationale and needs_revision history) — so
reviewers see the LLM/human feedback behind it. A `published.json` in each
unit carries the true publish timestamp, so dates survive
`units:fetch`/clones. Unpublished drafts (the local review queue) stay in the
workbench; `npm run drafts:export` dumps all drafts + reviews (dates
preserved) to a portable JSON for backup/migration/review, and
`npm run drafts:import <file>` restores it idempotently. The approval state
machine, the human-over-LLM hierarchy, and the published-unit correction
model are documented in
[`docs/architecture/approval-flow.md`](docs/architecture/approval-flow.md).

Problem statements are Markdown and images are **URL references by default**
(https/data URIs): the web workbench and the VS Code flow panel render the
same statement, including images, when online. Bundling images as local unit
assets is a planned additive path for offline-first packs; URL references
remain supported and are preferred to keep storage local-first.

### Run the end-to-end tests

```sh
cd tools/template-authoring/workbench
npx playwright install chromium   # once per machine
npm run test:e2e                  # auto-starts a fresh Core and Vite
```

## Releases

- [`CHANGELOG.md`](CHANGELOG.md) tracks versions and compatibility notes.
- `v0.1.9` (layered approval and coherent workflow display) is tagged; see
  [`docs/development/release-v0.1.9.md`](docs/development/release-v0.1.9.md).
- `v0.1.8` (published-unit library and consistent list layout) is tagged; see
  [`docs/development/release-v0.1.8.md`](docs/development/release-v0.1.8.md).
- `v0.1.7` (focused practice workspace and core robustness) is tagged; see
  [`docs/development/release-v0.1.7.md`](docs/development/release-v0.1.7.md).
- `v0.1.6` (editor robustness and disk pressure) is tagged; see
  [`docs/development/release-v0.1.6.md`](docs/development/release-v0.1.6.md).
- `v0.1.5` (review workflow and filtering) is tagged; see
  [`docs/development/release-v0.1.5.md`](docs/development/release-v0.1.5.md).
- `v0.1.4` (web workbench UI polish) is tagged; see
  [`docs/development/release-v0.1.4.md`](docs/development/release-v0.1.4.md).
- `v0.1.3` (dev runner flow and cross-platform fixes) is tagged; see
  [`docs/development/release-v0.1.3.md`](docs/development/release-v0.1.3.md).
- `v0.1.2` (dev runner, CI, web UI, docs patch) is tagged; see
  [`docs/development/release-v0.1.2.md`](docs/development/release-v0.1.2.md).
- `v0.1.1` (tooling/CI/security patch) is tagged; see
  [`docs/development/release-v0.1.1.md`](docs/development/release-v0.1.1.md).
- `v0.1.0` (internal trial) is tagged; its execution record, audit notes, and
  artifact checksums are in
  [`docs/development/release-v0.1.0.md`](docs/development/release-v0.1.0.md).
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

The current implementation provides a Rust core with five practice modes
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
