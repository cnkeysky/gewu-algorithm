# GEWU Agent Rules

Work here follows the development playbook
[`docs/development/agent-playbook.md`](docs/development/agent-playbook.md).
The rules below are the hard minimum; the playbook holds the detail and the
project-specific lessons.

## Workflow

1. **Design before code.** Clarify state machines, data flow, and boundaries
   before implementing. Real changes update `docs/decisions` (numbered ADRs)
   and the relevant architecture doc.
2. **Cascade audit.** Every change cascades to frontend, backend, CLI/scripts,
   tests, docs, README, CHANGELOG, and release notes as needed. Search for
   stale references and stale old-design assumptions before renaming anything.
   Do not reuse element ids or data attributes across views; shared
   components must branch on their entry point.
3. **Semantic consistency.** Compiling and green tests are not correctness.
   After every change, verify that statuses, labels, buttons, and panels tell
   one story, that API guards match the UI, that legacy data has a defined
   fallback, and that concurrency boundaries still hold. Re-run key paths
   with real data.
4. **Tests.** Add or update tests for new behavior; delete stale ones. Use
   Playwright against the real stack for UI, with geometry assertions and
   polling to avoid flaky races.
5. **UI consistency.** Fixed-height paginated lists with a scroll safety net;
   stepper semantics are done/current/pending; use in-app modals, never
   native prompts; new controls must not break existing ordering or layout.
6. **Documentation.** Behavior changes go in CHANGELOG under `[Unreleased]`.
   Keep the main README overview-level; details live in `docs/`. Keep
   numbering consistent (ADRs, roadmap stages, state tables).
7. **Versioning and release.** Run `npm run check:version` before any
   release; release is an explicit, confirmed action; create the gh release
   with notes. Small changes stay in `[Unreleased]`.
8. **Confirm before acting** on breaking changes, API changes, UI overhauls,
   releases, and data deletion; otherwise proceed and report.
9. **Security and data.** Never commit secrets; audit `.gitignore` before
   committing. Use idempotent migrations for schema changes and define
   fallbacks for existing data. Throttle high-frequency persistence in
   local-first apps.

## Required closure after every change

End with a short self-check, for example:

- Cascade audit: what changed in frontend / backend / CLI / tests / docs.
- Semantic check: stale assumptions searched; status-guard-legacy verified.
- Verification: which tests ran; which real paths were exercised.
- Records: CHANGELOG / README / docs updated.
