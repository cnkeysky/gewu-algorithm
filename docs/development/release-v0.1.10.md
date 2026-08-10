# v0.1.10 Release Record

Release on 2026-08-10: a reliable LLM publication gate, proxy-aware LLM
transport for relays **and** Pi built-in providers, a circuit breaker for
repeatedly failing drafts, and store-integrity tooling. The Rust core
reports `0.1.10`; the JSON-RPC protocol stays v2.

## Changes since v0.1.9

### Reliable LLM acceptance gate

- The gate never reads its own previous verdicts (no self-reference): feeding
  a reviewer its own past rejection caused echo — stale or hallucinated
  findings were repeated instead of re-derived from the artifact.
- A single `needs_revision` verdict on an artifact that passed deterministic
  validation gets one fresh independent re-read. Two agreeing rejections
  stick; an unconfirmed rejection no longer drives the artifact into a repair
  loop. Both verdicts stay in the audit trail
  (`llm_acceptance.json` + `llm_acceptance.recheck.json`) and the API
  response reports the `recheck` outcome.
- Batch drafts (generate → validate → accept, no pre-reviews) get a stable
  artifact identity (`acceptanceArtifactHash` path-hash fallback) so the
  gate records and de-duplicates its judgments per artifact; the re-read
  eligibility no longer silently disables for exactly the path where the
  echo incident occurred.

### Proxy-aware LLM transport

- All LLM transport (relay **and** Pi built-in providers) routes through an
  explicit `GEWU_LLM_PROXY`, falls back to `HTTPS_PROXY` / `HTTP_PROXY`
  (honoring `NO_PROXY`), or connects directly; `GEWU_LLM_PROXY=off`
  (`none`/`direct`) forces a direct connection. Implemented with undici's
  `EnvHttpProxyAgent` / `Agent` because Node's built-in fetch ignores proxy
  env vars and rejects a dispatcher from a different undici copy.
- Relay providers are declarative: `wireApi` (`responses` default for
  Codex-style gateways, `chat` for the standard completions shape),
  `opencodeHeaders` opt-in headers, non-strict tool schemas, and a generic
  key alias (`GEWU_LLM_KEY_FALLBACK=1` maps `GEWU_LLM_API_KEY` onto a
  built-in provider's own key env when unset). `xiaomi-token-plan-cn` is a
  Pi built-in (MiMo models mimo-v2-pro / mimo-v2.5 / mimo-v2.5-pro).

### Batch circuit breaker and store integrity

- Drafts persist a `failure_count` (incremented on failed generate/validate,
  reset on success); the batch quarantines a draft at `--max-failures`
  (default 3) and reports it as needs review; explicit human retries
  (`--force` / `--regenerate`, or the web Retry) reset the counter.
- `npm run drafts:reconcile` restores drafts whose published unit was
  clobbered back to `failed` by a stale-writer race (slug + language match,
  `--dry-run` preview), and the batch coverage summary now splits
  "covered by accepted draft" vs "covered by published unit only".
- Draft reuse is compare-and-set with cross-process claims/leases, the batch
  report reconciles against the live store, and slug-aware dedup prevents
  duplicate drafts across runs.

### Content pack

- Published units ship as a committed ledger (`units/index.json`: id,
  language, revision, modes, sha256) plus a `gewu-units-*.tar.gz` release
  asset; every unit carries its full review record (`reviews/`) and the true
  publish timestamp (`published.json`).

## Verification

- Rust gates (fmt, clippy, workspace tests), the TypeScript unit suite (84),
  the web workbench build, the VS Code test suite, and the Playwright e2e
  suite are green; CI passes on every push.
- `cargo audit` reports no vulnerabilities; `npm audit` (official registry)
  reports 0.
- Real LLM runs: hot100 covered 100/100 (mostly first-read passes on
  `xiaomi-token-plan-cn`/`mimo-v2.5-pro`), plus a real acceptance run on
  LeetCode 134 (Gas Station, Interview 150 sample) that generated, passed
  deterministic validation, passed the gate, and published. The motivating
  gate false-positive (recursive-implementation mismatch on flatten-binary-
  tree) was verified manually and published through the human-tier approval
  with a documented rationale.
