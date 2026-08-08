# Project-Independent Agent Rules (Global Template)

This file is a shareable copy of the global agent rules
(`~/.codex/AGENTS.md`) used across all repositories. It contains no
GEWU-specific detail, so collaborators can reuse it as-is:

- As a global rules file: copy the content below into `~/.codex/AGENTS.md`
  (or the equivalent global config of your agent tool).
- As a per-repo baseline: copy it into a repository's `AGENTS.md` and add the
  project-specific rules on top. Repo-level rules override this template.

Maintenance note (for maintainers, not part of the agent rules): keep this
file in sync with the global `~/.codex/AGENTS.md` and each repo's `AGENTS.md`;
rule changes must stay consistent across all three in the same commit. When
the same rules must apply in other tools (Claude Code / Cursor), write them
into the files those tools read (`CLAUDE.md` / `.cursorrules`) and keep them
consistent too.

---

Apply in every repository unless the repo's own AGENTS.md overrides.

Severity: rules 1-9 are musts; the closure self-check is required after every
change. Triggers: UI changes -> run the project's e2e with geometry
assertions; backend/CLI changes -> unit tests plus real paths; docs-only
changes -> update CHANGELOG/README without adding tests; releases -> the
project's release checklist. Read the project's detailed playbook (if any) on
demand before releases, migrations, or UI/layout work. These rules are
defaults; explicit user instructions override them - if the user asks to skip
one, follow the user and call it out in the closure. Rule changes should stay
consistent across this file and each repo's AGENTS.md.

1. Design before code: clarify state machines, data flow, and boundaries;
   record real decisions in numbered ADRs; update architecture docs.
2. Cascade audit: every change cascades to frontend/backend/CLI/tests/docs/
   README/CHANGELOG/release notes. Search for stale references and stale
   old-design assumptions before renaming. Do not reuse element ids or data
   attributes across views; shared components branch on their entry point.
3. Semantic consistency: compiling and green tests are not correctness.
   Verify statuses/labels/buttons/panels tell one story, API guards match
   the UI, legacy data has a defined fallback, concurrency boundaries hold;
   re-run key paths with real data.
4. Tests: add/update tests for new behavior, delete stale ones; use the real
   stack (e.g. Playwright) with geometry assertions and polling.
5. UI consistency: fixed-height paginated lists with scroll safety nets;
   steppers are done/current/pending; in-app modals, never native prompts;
   new controls must not break ordering or layout.
6. Documentation: behavior changes go in CHANGELOG under [Unreleased]; keep
   the main README overview-level; keep numbering consistent.
7. Security and data: never commit secrets; audit .gitignore; use idempotent
   migrations with legacy-data fallbacks; throttle high-frequency IO in
   local-first apps.
8. Versioning/release: run the project's version-sync check before release;
   release is explicit and confirmed; small changes stay unreleased.
9. Confirm before breaking changes, API changes, UI overhauls, releases,
   and data deletion; otherwise proceed and report.

Required closure after every change: report cascade audit, semantic check,
verification (tests + real paths), and which records were updated.
