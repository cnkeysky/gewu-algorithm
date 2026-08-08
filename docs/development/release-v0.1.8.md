# v0.1.8 Release Record

Release on 2026-08-08: a dedicated published-unit library, language-first
authoring and practice filters, and consistent card lists across Drafts,
Review history, Units, and the practice side panels. The Rust core reports
`0.1.8` (the handshake version comes from the crate version), so the web
connection badge reads `Core connected · v0.1.8 / protocol 2`. The JSON-RPC
protocol stays v2; the additive `language` fields on checkpoints, attempts,
and recommendations are backward compatible.

## Changes since v0.1.7

### Published-unit library (Units)

- A dedicated **Units** navigation page lists real published units: accepted
  drafts bound to a unit id, deduplicated by unit id (latest accepted
  revision wins). Rows show title, unit id, language, projections, and a
  Core-aware **Practice** button that preselects the unit in the workspace
  (the user still chooses the mode). Units uses its own scoped element ids and
  click handling so it never couples to Drafts state.
- The authoring form gains **Browse published units**: selecting a published
  unit loads its full form configuration as an edit, so submitting becomes a
  new revision of that unit (no duplicate units). Drafts keeps the full
  approval lifecycle, including Human approved rows and the Published filter.

### Language-first filtering

- Practice units can be filtered by language (always a concrete catalog
  language, never a catch-all), the unit list is filtered by the selected
  language, and Interrupted / Spaced review / Recent attempts show a language
  badge in the card footer where it can never be truncated by long labels.
- Drafts and Review history gain language badges and language filters; Drafts
  and practice gain title/problem/id search boxes.
- `listCheckpoints`, `recentAttempts`, and `reviewRecommendations` carry an
  optional `language` resolved from the unit implementation at read time.

### Automatic implementation strategies

- The web authoring form no longer asks for a variant count (`variants: 0`
  means auto); generation produces as many genuinely distinct strategies as
  the problem warrants (typically one canonical implementation) and never
  cosmetic variants. Shadow typing exposes one item per strategy; flow, code,
  reasoning, and transfer practice bind to the canonical implementation.
- An explicit `--variants N` in the batch CLI is enforced at generation time;
  the follow-up stage instructions name the canonical key, and stage
  validation normalizes bindings instead of failing the whole generation.

### Consistent list layout

- Drafts, Review history, and Units rows are cards with a background and fixed
  paginated areas; the practice side panels (Interrupted, Spaced review,
  Recent attempts) fit four checkpoints / recommendations and six attempts
  per page. All list areas use `overflow-y: auto` as a safety net, so content
  never clips silently; pagination clicks re-render only the clicked list.

### Batch authoring

- `tools/template-authoring/hot100.json` ships the official LeetCode Hot 100
  (python-only, refreshable with `npm run fetch:hot100`), duplicate detection
  is per problem + language + modes with interactive prompts and `--force` /
  `--select`, and the README documents that batch authoring needs only the
  authoring API and an LLM key.

## Verification

- Rust gates: `cargo fmt --check`, `cargo clippy --workspace --all-targets`,
  `cargo test --workspace` all pass.
- TypeScript/unit: template-authoring unit suite green.
- Playwright: full e2e suite green, including the layout suite (six-row fit,
  worst-case rows, empty states, no horizontal overflow on any view).
- Real DeepSeek generation verified for both auto and explicit two-strategy
  runs (shadow typing covers every strategy; recall/transfer bind canonical).
