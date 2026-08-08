# Changelog

All notable changes are documented here. Before `1.0`, incompatible changes are
allowed only with explicit migration notes (see
[`docs/development/release.md`](docs/development/release.md)).

## [Unreleased]

### Added

- Batch authoring ships `tools/template-authoring/hot100.json`: the current
  LeetCode Hot 100 from the official study plan (Chinese statements, clean
  Markdown), with every entry pinned to `language: "python"` so batch runs
  only generate Python templates. `npm run fetch:hot100` refreshes the catalog
  from LeetCode, and accepts `--language <slug>` / `--out <path>` to generate
  catalogs in other languages (for example
  `npm run fetch:hot100 -- --language java --out hot100-java.json`).

### Changed

- Practice variant options use humanized short titles (for example `Comments`,
  `Comment Guided Frontier`, `No Hints`) instead of raw id/layout/assistance
  composites. Code recall non-structured sessions no longer show a stale
  `hints undefined` segment in the session status line.
- The practice list rows (Interrupted, Spaced review, Recent attempts) and the
  active session context now show the same humanized variant label as the
  selector (for example `Comments` or `Fifo Shortest Distance · python-teaching`)
  instead of a raw `implementation · python-teaching` key. Implementation keys
  only appear when they are the actual selector (shadow typing).
- The core binary version now matches the product release: `gewu-core` and
  `gewu-cli` report `0.1.7`, so the web connection badge reads
  `Core connected · v0.1.7 / protocol 2` instead of the stale `v0.1.0`.
- Batch authoring CLI (`tools/template-authoring` → `npm run batch`): drives
  the authoring API for a list of problems (JSON or TSV), running the full
  pipeline — draft, staged LLM generation, deterministic validation, LLM
  pre-review (all roles concurrently), repair rounds from review feedback, and
  optional automated acceptance with an explicit audit-trail rationale. It
  defaults to all five practice modes and every code recall layout, supports
  `--concurrency`, `--steps`, `--repair-rounds`, and `--auto-accept`.
- Batch authoring duplicate handling is interactive: when a problem is already
  covered by an accepted unit the CLI asks whether to skip, regenerate this
  problem, regenerate all remaining duplicates, or quit (`--yes` keeps it
  silent for CI; `--force` regenerates everything). `--select` runs only the
  given ids/slugs/titles instead of rescanning the catalog, and problems may
  pin their own `language` (the Hot 100 catalog pins Python).
- Batch authoring duplicate identity is `problem + language + modes`: a
  template in one language is never treated as a duplicate of an accepted
  template in another language, so Python and Java templates for the same
  problem coexist as separate units. An explicit `--language <slug>` overrides
  the catalog default (hot100.json defaults to Python); the batch runner
  forwards `--language` whenever it is given explicitly.
- Practice summaries carry the resolved implementation language:
  `listCheckpoints`, `recentAttempts`, and `reviewRecommendations` each include
  an optional `language` field, resolved from the unit implementation at read
  time (additive; omitted when the unit is no longer resolvable).
- The web practice workspace adds a language filter for practice variants and
  language badges on Interrupted, Spaced review, and Recent attempts rows; the
  Drafts and Review history views add language badges and filters. The VS Code
  extension shows the language in checkpoint and attempt listings. The practice
  language selector always defaults to a concrete catalog language (never a
  catch-all), so starting practice is unambiguous, and the workspace status
  line summarizes the real Interrupted / Spaced review / Recent attempts state
  instead of a stale action message.
- Implementation strategy count is automatic: the web authoring form no longer
  asks how many variants to generate (`variants: 0` means auto), and the
  generation instructions treat variant count as unconstrained: generate as
  many genuinely distinct solutions as the problem warrants (typically one
  canonical implementation, rarely more than three) and never variants that
  differ only cosmetically. Shadow typing exposes one item per implementation
  strategy; flow recall, code recall, reasoning recall, and transfer practice
  bind to the canonical first-declared implementation only — their practice
  variants are exercise formats, not additional implementations. The batch CLI
  keeps `--variants N` as an explicit override (default auto), the practice
  projections note explains the binding, and the generation-profile summary
  shows `Implementation strategies: auto`.
- Web authoring preserves an existing draft's explicit strategy count when
  editing (only new drafts default to auto), and the practice unit list is
  filtered by the selected language so a unit with no options in that language
  is hidden instead of failing on start. Practice summaries resolve language
  to `None` (unknown) when the selected implementation no longer exists in the
  current revision instead of guessing from the first implementation.
- Code recall assistance options in the web authoring form are narrowed to
  the two that actually drive generation (Comments, Cloze); the legacy
  Keywords / Skeleton / No hints checkboxes were no-ops because layout
  derivation only reads comments and cloze (full recall is always included).
- Batch authoring documents its default output as 8 practice kinds: shadow
  typing, flow recall, the four code recall layouts (full recall, comment
  guided, comment to code, cloze), reasoning recall, and transfer practice —
  plus one shadow typing item per implementation strategy.
- The canonical-binding design is now enforced, not just instructed:
  `validateStageArtifact` normalizes code recall / reasoning recall / transfer
  practice bindings to the canonical first-declared implementation (their
  content is already verified verbatim against the canonical source, so a
  wrong variant label no longer fails the whole generation), and
  `assertVariantCoverage` requires shadow typing to cover every implementation
  strategy while other modes bind to the canonical one. The follow-up stage
  instructions name the canonical key explicitly and no longer ask the model
  to cover every variant in recall or transfer modes — that residue
  contradicted the auto strategy model and caused real generation failures
  with explicit `--variants N`.
- Code recall layout derivation is extracted to `codeRecallLayoutsFor`
  (comments + cloze → the four layouts; full recall always included; other
  assistance values are contract-compatible no-ops), and an explicit
  `--variants N` count is enforced at generation time (auto remains
  unconstrained). The legacy `gewu-llm` profile validation also accepts
  `variants: 0` (auto). Documentation updated to match the canonical-binding
  model, and the README now states that batch authoring needs only the
  authoring API and LLM key — the web client and Rust Core are not required
  for generation.
- The PROBLEM statement renderer supports Markdown images: `img` stays
  allowed through the sanitizer (https/data/relative sources, `alt` preserved)
  and is constrained to the pane width with a rounded, centered layout.
- The VS Code flow panel renders the problem statement as Markdown with the
  same safe subset as the web workbench (headings, lists, code, tables, links,
  and https/data images; CSP now allows `img-src https: data:`), so the same
  unit shows consistent content in both clients online. Images are URL
  references by default to keep storage local-first; local unit assets are a
  planned additive path.
- The template authoring instruction tells the LLM to keep original Markdown
  image references (https URLs or relative asset paths) in `problem.statement`.
- The practice start form labels every mode's choice the same way:
  "Practice variant" (shadow typing previously showed "Implementation
  variant"). The internal selector distinction is unchanged — shadow typing
  still requests by implementation key, other modes by practice id.

## [0.1.7] - 2026-08-08

### Changed

- Pagination is simplified to numbered buttons with ellipsis plus previous/
  next; the standalone go-to-page input is removed (data volumes are small and
  numbered-window navigation is the mainstream pattern). The count reads
  `1–6 of 24` without the "Showing" prefix, and the practice variant selector
  keeps its selection when lists refresh.
- Active practice enters a focus mode: the start controls and the
  Interrupted/Spaced review/Recent attempts panels hide so the problem and
  editor fill the workspace, with a "Back to workspace" button to return while
  the session stays active. The focused workspace is a dedicated layout: a
  full-width toolbar (title, status, Back, Stop) on top, then the problem and
  editor at equal height with a draggable divider (LeetCode-style), filling
  the viewport without page scroll.
- Internal identifiers no longer surface in the UI: practice variant labels
  drop the unit prefix and are short names only, the session context shows
  `mode · variant` instead of raw practice ids, and the home terminal unit is
  populated from the practice catalog instead of a hardcoded id.

### Fixed

- The practice workspace and the focused session workspace are now two
  separate views instead of one shared layout with toggled `hidden`/classes:
  the start page never shows editor-area elements, and the session view keeps
  its own full-bleed LeetCode-style split. This removes the `hidden` vs
  `display` attribute conflicts that let the draggable divider and session
  content overlap the editor and the action buttons.
- Starting the same unit/mode/variant while a session is active now resumes
  that session in place; choosing a different unit, mode, or variant stops the
  current session and starts the new selection as before.
- The code editor shell respects its hidden state again (the flex display rule
  no longer overrides `hidden`), so answer-based modes no longer leave a
  phantom editor box in the layout.
- The focused session view starts directly below the top bar: the shared page
  shell's top padding is cleared in focus mode, removing the dead strip above
  the Active session toolbar (the viewport height now accounts only for the
  top bar).
- The Rust HTTP core no longer exits when a client disconnects mid-request
  (`broken pipe`): per-connection failures are logged and the server keeps
  serving. This removes the flaky "core host failed" exit that made the
  Playwright e2e suite fail partway through in CI.
- Rust sources are rustfmt-clean again (CI's `cargo fmt --check` was failing
  on a newly introduced method chain).

## [0.1.6] - 2026-08-07

### Changed

- Shadow typing / code recall Enter handling is anchored to the accepted
  boundary instead of the cursor, and newlines are validated locally against
  the target before insertion. Enter only inserts when the target actually
  expects a newline, so a held/repeated Enter is silently ignored instead of
  stacking newlines that Core rejects and rolls back (the recurring "Enter
  does not advance" issue). Applies to every code editor mode.
- Spaced review only schedules material completed at least once:
  interrupted-only history produces no recommendation (it stays in the
  Interrupted panel); the `Inconclusive` recommendation kind is removed.
- Core throttles recovery checkpoint writes (at most once per 1.5s per
  session), so typing no longer writes the checkpoint at every batched event;
  the workbench forces a final checkpoint on page unload, keeping recovery
  granularity. The JSON-RPC protocol is unchanged (version stays 2).
- The shadow guidance ghost repaints immediately from the local value, so
  deleting or correcting characters never leaves a stale or missing hint
  while Core confirms.
- Draft action buttons and practice start/stop ignore rapid repeated clicks
  (in-flight locks), and the code editor auto-activates on start/resume so
  Enter and typing work immediately without a click.
- Shadow typing / code recall editors enqueue every content change instead of
  batching: a wrong character is rejected on its own while the correctly typed
  prefix stays accepted (fast typing no longer rolls back the whole batch),
  and a large wrong paste is still one atomic rejection. The ghost hint keeps
  showing the correct next input while a wrong character is pending.

## [0.1.5] - 2026-08-07

### Changed

- Artifact inspection is now a modal opened from Drafts or Review history
  (the Review history "View feedback" action works again). The manifest gets
  its own full-width, taller editor; binary cache files (`.pyc` /
  `__pycache__`) are hidden from Source and tests; and LLM pre-review findings
  render as severity-colored cards with pagination and role verdict chips.
- Review history is paginated like the other lists, and a draft blocked by
  `needs_revision` gets an explicit "Open artifact to revise" action in the
  workflow gate.
- Human-edited artifacts can be published directly: saving a revision records
  a `human_revision` pass review and moves the draft to `validated`, where both
  "Human approve" and "LLM pre-review" are offered. Running the LLM pre-review
  again after a human edit is supported and reports the real outcome instead of
  always claiming all roles passed.
- `needs_revision` drafts get a prominent "Revise artifact" action and a
  workflow "Open artifact to revise" button; LLM pre-review findings are
  paginated with the standard "Showing X–Y of Z" control inside a fixed-height
  container, and audit trail verdicts are color-coded (pass green,
  needs_revision/reject red) with readable labels.
- Draft actions show a global toast so feedback is visible from the Drafts
  page (the old inline message lived in the hidden authoring form); actions
  refresh the list in place without resetting the page or scroll position;
  list ordering is deterministic (created_at + insertion tiebreaker); the
  accepted-draft action is renamed "Extend unit" to match what it does.
- Drafts and Review history gain status/verdict filter pills with live counts
  (Drafts: All / Needs attention / In progress / Published; History: All /
  Pass / Needs revision / Reject). Filters slice before pagination, reset to
  page one, and show targeted empty states. The pagination strip reserves its
  space on single-page and empty lists, so switching filters no longer moves
  the surrounding layout; the Review history empty state fills the same fixed
  height as its list so verdict filters with no matches do not collapse the
  view.

## [0.1.4] - 2026-08-07

### Changed

- Pagination redesigned: hidden when a list fits on one page, numbered page
  buttons with previous/next, and a go-to-page input (Enter to jump) only for
  many pages; the standalone Go button is removed.
- Drafts list uses a fixed-height area without an inner scrollbar, so the
  drafts view no longer shifts with content.
- Drafts list height is sized to exactly six rows from real measured layout,
  and unpublished drafts can be deleted from the row actions with cascading
  cleanup (artifact directory and review reports); accepted drafts stay
  immutable and cannot be deleted.
- Practice workspace: controls span the full width, then the problem statement
  and the active session sit side by side (LeetCode-style) on desktop and stack
  on narrow screens; the problem pane appears only after a practice starts and
  fills the column height above the side panels.
- The session header now carries the live status line (progress, accepted,
  rejected, corrections) and the Stop practice action, so the bottom of the
  session no longer ends with a loose status row; spacing between the session
  heading and the editor is tightened. Progress is shown as a percentage, and
  the active session's recovery checkpoint is marked "in progress" in the
  Interrupted list.
- Practice side panels (Interrupted, Spaced review, Recent attempts) form one
  padded card with symmetric column spacing; each record keeps title, mode and
  variant, and progress on separate lines, long titles wrap to two lines, and
  entries have comfortable vertical gaps.
- Paginated practice lists use the same numbered-page pagination as Drafts
  (hidden on a single page). The workspace shell is slightly wider
  (max-width 1360px), and the practice view matches the horizontal inset of the
  other pages.
- The workbench dev server polls for file changes so WSL2 and atomic-save
  editors do not leave the browser tab on stale modules.

### Docs

- Reorganized the root README Option A: `npm run dev` and the action menu
  first, then the guided start flow, then a separate non-interactive section
  with env/flag examples.
- CI skips documentation-only changes (markdown or `docs/`) and supports
  manual `workflow_dispatch` runs; schema and code changes still trigger it.

## [0.1.3] - 2026-08-07

Dev runner flow and cross-platform fixes. No protocol, schema, or
practice-mode behavior changes since v0.1.2.

### Changed

- `npm run dev` now opens the action menu (a bare `node scripts/gewu-dev.mjs`);
  direct start moved to `npm run dev:start`. Choosing `1) Start` guides through
  LLM configuration (keep or change) and ports (keep or change) before
  installing, building, reading the API key, and starting services;
  non-interactive runs skip the prompts.
- Prerequisite probes and the setup order are fixed for Windows non-interactive
  runs (`npm.cmd` is spawned through the shell; prerequisites are checked before
  any prompt).

## [0.1.2] - 2026-08-07

Dev runner, CI, web UI, and documentation. No protocol, schema, or
practice-mode behavior changes since v0.1.1.

### Changed

- Dev runner services now run in the background and the script exits after
  starting them. Running the script without a command opens an action menu
  (`1` start, `2` stop, `3` status, `4` prepare, `5` restart, `0` exit) with
  one-line descriptions for each action;
  `start` probes existing services and only starts the missing ones; a new
  `dev:status` script shows what is running and healthy.
- Paginated web lists (Drafts, Interrupted, Spaced review, Recent attempts)
  now show an entry range and current page (`Showing 1–6 of 24 · Page 1 / 4`),
  a jump-to-page input, and pinned pagination that does not move with content;
  draft workflow labels are separated with `›` so they no longer run together.
- `dev:stop` now terminates every process listening on the configured ports,
  including leftover grandchildren from older script versions and external
  processes, with a SIGKILL fallback after a grace period.
- The dev runner resolves `cargo.exe` on Windows (previously `cargo` was not
  found), and CI smoke-tests the runner on Linux, macOS, and Windows.

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
