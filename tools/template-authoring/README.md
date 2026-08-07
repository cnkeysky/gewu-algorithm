# GEWU Template Authoring

This package is the optional provider-backed authoring adapter for Stage 7.
It uses `@earendil-works/pi-ai` for provider selection, authentication,
streaming, and model compatibility. It does not own practice transitions or
publish content. Drafts follow an explicit gate: `queued` -> `generated` ->
`validated` -> `llm_reviewed` -> `accepted`; only the final human approval can
promote a template.

The package intentionally imports Pi-ai only here. Rust Core and VS Code do not
depend on npm provider packages.

The current real integration test target is DeepSeek only. Other provider
profiles remain provider-neutral compatibility paths until their credentials
are available for dedicated integration runs.

## Provider selection and secrets

Provider/model selection is configured with `GEWU_LLM_PROVIDER` and
`GEWU_LLM_MODEL`. Credentials are never part of GEWU configuration and must be
injected through the provider's environment variable, for example
`DEEPSEEK_API_KEY`. Keep local values in the shell (or use a separate dotenv
loader such as `direnv` for an ignored `.env` file); this package does not load
`.env` implicitly. Never commit secrets or paste them into command arguments.

To run a real DeepSeek connectivity smoke test from this directory:

```sh
read -s "DEEPSEEK_API_KEY?DeepSeek API key: "; export DEEPSEEK_API_KEY; echo
GEWU_LLM_PROVIDER=deepseek GEWU_LLM_MODEL=deepseek-v4-flash npm run smoke
unset DEEPSEEK_API_KEY
```

For local repeatable testing, fill in the ignored `.env.local` file and run:

```sh
npm run smoke:local
```

`.env.local` is a convenience file, not a secure vault. Do not copy it into
issues, logs, screenshots, or commits.

The command prints only a success record containing provider, model, and task
identity. It does not persist prompts, responses, or credentials. Other
providers use the same two selection variables and the credential names
defined by Pi-ai; inspect its model catalog rather than copying provider URLs
or secrets into this repository.

Structured generation and review use a required Pi-ai tool call. Tool
arguments are validated against the task schema before GEWU sees them; plain
text or malformed arguments are rejected, with at most one bounded repair
attempt.

Generation requests may include a `GenerationProfile` to select several
practice projections and implementation variants for one algorithm unit. The
profile is a request contract, not a second template format. The planned local
authoring workbench is documented in
[`docs/architecture/template-authoring-workbench.md`](../../docs/architecture/template-authoring-workbench.md).

## End-to-end draft generation

The DeepSeek integration task generates a new algorithm unit from the problem
text you supply, using one algorithm-agnostic generation prompt. It writes only
to a timestamped ignored `drafts/generated-*/` directory and always remains
`pending` for human review.

```sh
npm run generate-template:local -- "Given an array of integers, return the indices of the two numbers that add up to a target."
```

The command requires the ignored `.env.local` file to contain `DEEPSEEK_API_KEY`.
It writes `unit.json`, `code/python.py`, and non-secret `generation.json`, then
performs response-shape checks, deterministic source-template derivation,
Python syntax, and the real Rust `gewu-template` manifest loader. It first
writes to an ignored staging directory and exposes the final draft only after
those checks pass. The adapter overwrites `provenance.generated_by` with its
own trusted provider, model, task version, and timestamp, and resets all
lifecycle and validation claims to `draft` and `pending`. A success record with
`contractValidation: "passed"` only means the draft can be reviewed; it does
not mean that its content is accepted or publishable.

To run local non-network checks for the authoring adapter:

```sh
npm test
```

## Local authoring workbench

Start the persistence API and Vite client in separate terminals:

```sh
npm run workbench:api
npm run workbench:dev
```

Use `npm run workbench:api:local` when the API should load the ignored
`.env.local` DeepSeek configuration for live generation.

The API stores draft metadata and review records in the ignored SQLite database
`drafts/.workbench/authoring.sqlite`; an earlier `state.json` is migrated once.
It never accepts provider credentials. The UI falls back to browser local
storage when the API is unavailable. Generation and validation both invoke the
Rust template validator, so malformed artifacts never become reviewable. The
`POST /api/drafts/:id/reviews` endpoint runs the LLM pre-review and stores its
report and artifact hash. The UI exposes the generated manifest, source files,
and findings, while `POST /api/drafts/:id/accept` requires a passing review and
an explicit human action. `POST /api/drafts/:id/rollback` clears the current
artifact, keeps prior reports immutable, and returns the draft to
`revision_requested` so it can be generated again.

Paginated lists (Drafts, Interrupted, Spaced review, Recent attempts) show an
entry range (`Showing 1–6 of 24`) and numbered page buttons with previous/next.
A go-to-page input (press Enter to jump) appears only when there are many pages,
and the pagination bar is hidden when everything fits on one page. Drafts
pagination is pinned below a scrollable list, so page content changes do not
move it.

Human approval also publishes a validated copy under
`drafts/.workbench/published/` by default. Set `GEWU_PUBLISHED_ROOT` to point at
the content root used by `gewu-cli`; the published directory contains only
Core-readable unit files. A generated artifact can be edited in the Artifact
inspector and saved through `PUT /api/drafts/:id/artifact`; the Rust validator
must pass again and previous LLM reviews are cleared before another review.
Each approval also rebuilds `pack.json` with the Rust pack tool. Start Core
against the same directory to practice the accepted units:

```sh
GEWU_PUBLISHED_ROOT="$PWD/tools/template-authoring/drafts/.workbench/published" \
cargo run -p gewu-cli -- serve --content-root "$GEWU_PUBLISHED_ROOT" --data-root .gewu-data
```

The pack can be checked independently with
`cargo run -p gewu-template --bin pack -- verify <content-root> <content-root>/pack.json`.

Existing drafts can be revised with `PATCH /api/drafts/:id`. A revision keeps
the draft identity, clears its current artifact pointer, returns it to
`queued`, and writes future generations into a new artifact directory; older
review reports remain immutable history.

## First-party Web Practice

The Practice workspace is backed by Rust Core rather than the authoring API.
Start the loopback Core HTTP adapter from the repository root, then run the
Vite client:

```sh
cargo run -p gewu-cli -- serve --content-root fixtures/algorithm-units/valid --data-root .gewu-data
npm run workbench:dev
```

Open `http://127.0.0.1:5173/`, select `Practice`, and use the unit/mode
picker. Vite proxies `/core/rpc` to the Rust adapter; scoring, checkpoint
recovery, attempts, and review recommendations remain Rust-owned.

Generation uses one algorithm-agnostic task in the TypeScript task registry.
`GET /api/tasks` returns its id and version. The task owns the contract prompt,
output schema, and artifact validator; every algorithm decision is inferred
from the author's problem input, so no per-algorithm task or prompt template is
required. The pipeline has been verified through real DeepSeek generation
(Two Sum, Course Schedule, Binary Search, Kahn topological sort), deterministic
validation, and correctness review.

Rule proposals can be checked locally before involving a model:

```sh
npm run rule-dedup -- NEW-RULE "The implementation and assumptions match declared space and time bounds."
```

Exact and high-similarity rewrites are automatically marked `duplicate`; only
independent or ambiguous proposals become `needs_review`.
