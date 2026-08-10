# GEWU Template Authoring

This package is the optional provider-backed authoring adapter for Stage 7.
It uses `@earendil-works/pi-ai` for provider selection, authentication,
streaming, and model compatibility. It does not own practice transitions or
publish content. Drafts follow an explicit gate: `queued` -> `generated` ->
`validated`, then publication through either the content gate (three
pre-review roles pass -> `llm_reviewed`) or the decisive LLM acceptance gate
(`llm_acceptance`). Accepted units are labeled **Human approved** or **LLM
approved**; human approval is the superior tier and can upgrade any
LLM-approved unit.

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

### Relay / custom OpenAI-compatible endpoint

To route requests through a relay or proxy (for example a third-party API
gateway), register it as a custom provider instead of relying on a built-in
URL:

```sh
GEWU_LLM_PROVIDER=relay \
GEWU_LLM_MODEL=<relay model id> \
GEWU_LLM_BASE_URL=https://api.example.com/v1 \
GEWU_LLM_API_KEY=<relay key> \
npm run smoke
```

The wire protocol follows the entry's `wireApi` in `providers.json`: the
default relay entry speaks the OpenAI Responses API (`/responses`, what
Codex-style gateways expect); `wireApi: "chat"` targets the standard
`/chat/completions` shape. The same variables go into the ignored
`.env.local` for repeatable local runs; the relay key is accepted only
through `GEWU_LLM_API_KEY` — provider keys like `DEEPSEEK_API_KEY` are never
sent to a relay endpoint, so a real provider key cannot leak to an arbitrary
gateway. The relay defaults to `GEWU_LLM_TOOL_CHOICE=auto`;
OpenAI-compatible relays that accept a forced tool call should set
`GEWU_LLM_TOOL_CHOICE=forced` so the model always returns structured output
instead of finishing with plain text. Other providers are unaffected when
the base URL is unset. Relay requests strip the OpenAI SDK fingerprint
headers (`x-stainless-*`) and send a neutral user agent; the opencode-style
`x-opencode-session` / `x-opencode-request` headers are opt-in per entry
(`opencodeHeaders: true` in `providers.json`), because only some Codex-style
gateways prefer that convention.

Provider configuration is a declarative key-value mapping. Built-in
providers (deepseek, openai, moonshotai, xiaomi, and everything Pi-ai ships)
are **derived from the Pi package** — ids, labels, models, and key env
conventions come from Pi, so vendor changes are handled by updating Pi.
Relays are our OpenAI-compatible extension and live in `providers.json`
(`id -> { label, keyEnv, baseUrlEnv, wireApi, opencodeHeaders }`); adding a
named relay is data-only: add an entry, set its env vars, and point
`GEWU_LLM_PROVIDER` at it. Relay transport honors `GEWU_LLM_PROXY`
(`off`/`none`/`direct` forces a direct connection), otherwise
`HTTPS_PROXY` / `HTTP_PROXY` (`NO_PROXY` applies), or connects directly when
no proxy is configured.

### Generality and boundaries

The relay provider is generic and configured entirely by environment
variables; no endpoint URL is hardcoded. It works with any OpenAI-compatible
gateway (`/v1/chat/completions` with `wireApi: "chat"`, or `/v1/responses`
with `wireApi: "responses"`):

- **Protocol**: OpenAI-compatible chat completions or Responses per
  `wireApi` (Anthropic Messages gateways are not supported by the generic
  relay);
- **Auth**: Bearer token via `GEWU_LLM_API_KEY` (relay-only; provider keys are
  never used for the relay);
- **Models**: one model id per run, set via `GEWU_LLM_MODEL`; the relay's
  model list is not auto-discovered;
- **Compatibility defaults**: non-strict tool schemas (open gateways vary in
  JSON-schema enforcement), DeepSeek-style chat defaults (`max_tokens`, no
  `store`/`strict`, `thinkingFormat: deepseek`) with `toolChoice=auto` and
  `reasoning_effort: "none"` (thinking disabled via `GEWU_LLM_REASONING_EFFORT`),
  because reasoning-mode upstreams reject forced tool calls and often ignore
  `thinking: {type:"disabled"}`; set `GEWU_LLM_TOOL_CHOICE=forced` if the
  gateway supports strict tool calls, or a higher reasoning effort to
  re-enable thinking;
- **Timeout**: the default per-call `GEWU_LLM_TIMEOUT_MS=120000` is too low for
  slow reasoning-mode relays — raise it (e.g. `600000`) and keep the batch
  `--timeout-minutes` above the total request duration;
- **WAF compatibility**: the header behavior above is generic — gateways
  simply ignore headers they do not recognize.

Structured generation and review use a required Pi-ai tool call. Tool
arguments are validated against the task schema before GEWU sees them; plain
text or malformed arguments are rejected, with at most one bounded repair
attempt.

Generation requests may include a `GenerationProfile` to select several
practice projections and implementation strategies for one algorithm unit. The
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

The command requires the ignored `.env.local` file to contain the configured
provider's key (e.g. `DEEPSEEK_API_KEY`, or `GEWU_LLM_API_KEY` for the relay).
It writes `unit.json`, `code/python.py`, and non-secret `generation.json`, then
performs response-shape checks, deterministic source-template derivation,
Python syntax, and the real Rust `gewu-template` manifest loader. It first

Generation is language-aware: source/test paths follow
`code/<language>.<extension>` / `tests/<language>_test.<extension>`, the
manifest id ends with the language segment (ADR 0019), and every
implementation is forced to the unit's language. Python-specific rules
(importlib loader, `from code.python import ...` guard, in-memory syntax
check) apply only to Python; non-Python executable validation is a follow-up
item — the Rust manifest validator remains language-agnostic.
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
and findings, while `POST /api/drafts/:id/accept` publishes from `llm_reviewed`,
from `needs_revision` with an explicit human override plus rationale, from a
validated artifact with a human revision, or — decisively — from any validated
artifact when the `llm_acceptance` gate passed (no human step; the audit trail
records `llm_acceptance`). The web workbench exposes the gate as an **LLM
approve** action on `validated` / `llm_reviewed` / `needs_revision` drafts; a
gate verdict of `needs_revision` moves the draft to that state so revision is
offered before the next attempt. `POST /api/drafts/:id/rollback` clears the
current artifact, keeps prior reports immutable, and returns the draft to
`revision_requested` so it can be generated again.

Paginated lists (Drafts, Interrupted, Spaced review, Recent attempts) show an
entry range (`Showing 1–6 of 24`) and numbered page buttons with previous/next.
A go-to-page input (press Enter to jump) appears only when there are many pages,
and the pagination controls are hidden when everything fits on one page while
the strip keeps its height, so the layout never shifts. Drafts and Review
history also offer status/verdict filter pills with live counts (Drafts: All /
Needs attention / In progress / Published; History: All / Pass / Needs
revision / Reject). Drafts pagination is pinned below a fixed-height list (no
inner scrollbar, sized to exactly six rows), so page content changes do not
move it and the page does not shift. Unpublished drafts can be deleted from the
row actions (accepted drafts are published and immutable); deletion also
removes the draft's artifact and review reports.

Human approval also publishes a validated copy under
`drafts/.workbench/published/` by default. Set `GEWU_PUBLISHED_ROOT` to point at
the content root used by `gewu-cli`; the published directory contains only
Core-readable unit files plus the unit's **full review record** under
`reviews/` (LLM pre-review role reports, the acceptance gate report, and a
distilled `reviews/summary.json` with the acceptance rationale and
needs_revision history). Published units ship as a **content pack**:
`npm run units:pack` regenerates the committed ledger
`units/index.json` (id, language, revision, modes, sha256) and a
`gewu-units-*.tar.gz` for `gh release upload <tag> <tarball>`; a fresh clone
runs `npm run units:fetch` to extract the pack for practice, and batch dedup
works from the ledger alone. Each unit carries `published.json` with the true
publish timestamp (the ledger and the web Units page read it, so dates survive
clones). The local authoring state — unpublished drafts and their review
feedback (the review queue) — is exported with `npm run drafts:export` to a
portable JSON (dates preserved) and restored with
`npm run drafts:import <file>`. A generated artifact can be edited in the Artifact
inspector modal (opened from Drafts or Review history) and saved through
`PUT /api/drafts/:id/artifact`; the Rust validator must pass again and
previous LLM reviews are cleared before another review.
The edited artifact can then be approved directly (a `human_revision` review is
recorded) or sent through the LLM pre-review again.
Each approval also rebuilds `pack.json` with the Rust pack tool. Start Core
against the same directory to practice the accepted units:

## Batch template authoring

`node dist/batch-authoring.js --problems <file.json|tsv>` runs the whole
authoring pipeline for many problems. Defaults:

- **Modes**: all five practice modes (`shadow_typing`, `flow_recall`,
  `code_recall` with its four layouts, `reasoning_recall`, `transfer_practice`);
  pass `--modes` to narrow them.
- **Steps**: `draft,generate,validate,review,accept`; the three pre-review
  roles run before the acceptance gate. To make the LLM gate the sole
  reviewer — the recommended default for automated runs — pass
  `--steps draft,generate,validate,accept --llm-approve <provider:model>`.
- **LLM approval**: enabled by default when the accept step is on — a gate
  pass publishes with the **LLM approved** label. The approver defaults to the
  environment's `GEWU_LLM_PROVIDER`/`GEWU_LLM_MODEL` (else
  `deepseek:deepseek-v4-flash`); with a relay, export those or pass
  `--llm-approve relay:<model>` explicitly. `--auto-accept` opts into an
  operator-tier override instead.
- **Deduplication**: identity is `slug`/id + language, unified with a
  **statement fingerprint** (NFKC + lowercase + collapsed whitespace,
  SHA-256) — a problem matches an existing draft when its slug **or** its
  fingerprint hits, so cross-catalog slug variants and slug-less web drafts
  resolve to the same problem. Unit ids are language-qualified
  (`<slug>.<language>`), so Python and Java templates publish as separate
  units; `--regenerate <ids>` forces specific problems as new revisions.
  Residual limitation: two genuinely different wordings of the same problem
  without a shared slug or fingerprint cannot be auto-merged (semantic
  matching is out of scope). The web workbench warns before submitting a
  duplicate (same language + normalized statement or title).
- **Rate limits**: gateway 429s retry with exponential backoff; keep
  `--concurrency 1` (the default; 2 at most) on shared relays and add
  `--request-delay-ms 2000` so bursts do not trip Cloudflare-style security
  blocks; keep `--timeout-minutes` above the slowest generation. HTML 403
  security blocks are never retried, and a failed generation is not
  blind-retried — retries happen inside the generator with validation
  feedback, and a later run reuses the failed draft.

The interactive runner `npm run batch` (scripts/gewu-batch.mjs) defaults to
the same gate-only flow: steps default to `draft,generate,validate,accept`
(the LLM acceptance gate is the sole reviewer), the approver is derived from
`.env.local`/`GEWU_LLM_PROVIDER`/`GEWU_LLM_MODEL` (falling back to
`deepseek:deepseek-v4-flash`), and `--auto-accept` stays an explicit operator
override rather than an interactive default. Example with the relay:

```sh
GEWU_LLM_PROVIDER=relay GEWU_LLM_MODEL=deepseek-v4-flash npm run batch
```

```sh
GEWU_PUBLISHED_ROOT="$PWD/tools/template-authoring/drafts/.workbench/published" \
cargo run -p gewu-cli -- serve --content-root "$GEWU_PUBLISHED_ROOT" \
  --published-root "$GEWU_PUBLISHED_ROOT" --data-root .gewu-data
```

The core refuses to serve a published root that contains a non-`validated`
unit (fail-fast with the unit path). Pre-fix published units can be
backfilled once with `npm run stamp:published` (idempotent); new publishes are
stamped by the pipeline.

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
The workspace lays out the unit/mode picker across the top, the problem
statement on the left and the live session on the right (stacked below 940px),
with Interrupted, Spaced review, and Recent attempts in a card below. The
problem pane appears once a practice starts.

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
