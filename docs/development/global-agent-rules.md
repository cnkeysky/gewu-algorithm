# Project-Independent Agent Rules (Global Template)

This file is the project-independent agent rules template, shared so
collaborators can adopt the same baseline across repositories. It contains no
project-specific detail; repositories layer their own rules on top.

## How to adopt and which files are required

The rules are layered:

- **Hard minimum (required, resident)** — one rules file per agent tool,
  loaded at every session:
  - Codex: `~/.codex/AGENTS.md` (global) or the repository's `AGENTS.md`;
  - Claude Code: `CLAUDE.md`;
  - Cursor: `.cursorrules`.
  Every copy contains the numbered rules below and the closure self-check.
- **Detail (optional, on demand)** — a project playbook or standards document
  that the rules file links to. Fetch it only when a rule's detail matters
  (releases, migrations, UI/layout work, LLM-backed pipelines).

Adoption steps:

1. Copy this template into every tool config you use, as a global file or a
   per-repo file; per-repo copies may add project-specific rules on top and
   override this template.
2. Keep the closure self-check intact in every copy — it is what makes the
   rules auditable.
3. When rules change, update every copy in the same change: this template,
   the global configs, and each repository's rules file.
4. If the same rules must apply in other tools (Claude Code / Cursor), write
   them into the files those tools read and keep them consistent.

---

Apply in every repository unless the repo's own rules file overrides.

Severity: rules 1-10 are musts, each where it applies; the closure self-check
is required after every change and scales with the change's size. Triggers:
UI changes -> run the project's e2e with geometry assertions; backend/CLI
changes -> unit tests plus real paths; docs-only changes -> update the
project's change log / docs without adding tests; releases -> the project's
release checklist. Read the project's detailed playbook (if any) on demand
before releases, migrations, or UI/layout work. These rules are defaults;
explicit user instructions override them - if the user asks to skip one,
follow the user and call it out in the closure. Rule changes must stay
consistent across the global config, the shared template, and each repo's
rules file.

1. Design before code: clarify state machines, data flow, and boundaries;
   record real decisions in the project's numbered decision records (ADRs, if
   the project keeps them); update architecture docs, and the project roadmap
   (if any) when a stage or capability completes.
2. Cascade audit: every change cascades to every layer the project has -
   frontend, backend, CLI, tests, docs, change log, release notes. Before
   renaming or changing semantics, search for stale references and stale
   old-design assumptions and cite the search results in the change summary.
   Do not reuse element ids or data attributes across views; shared
   components branch on their entry point.
3. Semantic consistency: compiling and green tests are not correctness.
   Verify statuses/labels/buttons/panels tell one story, API guards match
   the UI, legacy data has a defined fallback, concurrency boundaries hold;
   re-run key paths with real data. For LLM-generated content, adapter or
   schema smoke checks alone do not qualify acceptance; run the full
   validation and review chain.
4. Tests: add or update tests for new behavior and delete stale ones in the
   same change as the code; use the real stack (e.g. Playwright for web UI)
   with geometry assertions and polling.
5. UI consistency (where a UI exists): follow the project's existing
   interaction conventions. If the project has steppers, their semantics are
   done / current / pending. Prefer in-app modals over native prompts unless
   the project's convention says otherwise. New controls must not break
   ordering or layout.
6. Documentation: behavior changes go in the project's change log (e.g.
   CHANGELOG, under an unreleased section if it uses one); keep the main
   README overview-level; keep numbering consistent.
7. Versioning/release: run the project's version-sync check before release;
   release is explicit and confirmed; small changes stay unreleased when the
   project keeps a change log.
8. Confirm before acting on breaking changes, API changes, UI overhauls,
   releases, data deletion, destructive commands (git reset --hard, rm -rf,
   and equivalents), and external side effects (publishing packages, opening
   PRs, sending messages); otherwise proceed and report.
9. Security and data: never commit secrets; audit ignore files before
   committing; use idempotent, re-runnable migrations with legacy-data
   fallbacks; throttle high-frequency IO in local-first apps.
10. DX and CI parity: provide memorable top-level commands that mirror CI
    gates; local and CI scripts invoke the same underlying commands. Managed
    scripts run non-interactively (defaults plus env vars or flags), and
    their stop action terminates every spawned background service (process
    groups or pid files), not just the parent.

Required closure after every change, scaled to its size:

- Small changes (typo/docs fixes, minor refactors): a one-line summary that
  still covers cascade audit, semantic check, verification, and records.
- Key changes (API/contract, data migration, UI/layout, release, LLM-backed
  pipelines): report cascade audit, semantic check, verification (tests +
  real paths), and which records were updated.
