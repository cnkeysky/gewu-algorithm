# v0.1.0 Release Record

Internal trial delivery. Executed on 2026-08-07 against
`docs/development/release.md`.

## Checklist Status

1. **Requirements and non-goals** — confirmed in
   [`docs/product/requirements.md`](../product/requirements.md) and
   [`docs/product/mvp.md`](../product/mvp.md).
2. **Changelog and compatibility** — [`CHANGELOG.md`](../../CHANGELOG.md)
   documents the release and the v2 protocol/schema compatibility contract.
3. **Cascade review / propagation matrix** — attached below for the only
   contract change since the last reviewed slice (optional
   `implementation` binding on reasoning/transfer items).
4. **Gates** — `cargo fmt --check`, `cargo clippy --workspace --all-targets
   -- -D warnings` (0 warnings), `cargo test --workspace`, TypeScript tests,
   Web build, VS Code adapter tests (24), and Playwright e2e (19) all pass.
   Schema/fixture/protocol/persistence coverage is part of the workspace
   suites.
5. **Dependency audits** — `npm audit` (official registry):
   template-authoring 0, workbench 0 after review, VS Code 0. The workbench
   depends on `dompurify@3.4.13` (latest reachable), which carries 2 moderate
   advisories affecting non-default configurations; the client sanitizes with
   `USE_PROFILES {html, mathMl, svg}` defaults and does not use the affected
   options (`CUSTOM_ELEMENT_HANDLING`, `RETURN_DOM`, `IN_PLACE`, function
   `ADD_TAGS`). Upgrade when a patched release is published. `cargo-audit` is
   v0.22.2; against the RustSec advisory database (1,190 advisories),
   `cargo audit` reports **0 vulnerabilities** across the 32 locked crate
   dependencies. The advisory DB fetch requires HTTPS access to
   `github.com/RustSec/advisory-db`; environments without that route can run
   `cargo audit --db <local-db> --no-fetch`.
6. **Binaries** — release build for Linux x86_64:
   `target/release/gewu`, `pack`, `validate` (checksums below).
7. **VSIX packaging** — `gewu-algorithm-0.1.0.vsix` packaged (41 files,
   81.61 KB). Headless installation into a VS Code profile was not executed;
   adapter behavior is covered by its 24 automated tests.
8. **Offline practice** — release binary stdio verified: handshake, unit
   listing, shadow typing session, 29 accepted characters, terminal attempt,
   and recent-attempts query, all with no network.
9. **Credential redaction and local deletion** — redaction of `sk-`/`key-`
   credential-like text is covered by a unit test; `delete-history` removed
   the offline attempt and `recent-attempts` returned empty.
10. **Upgrade from previous release** — not applicable; no prior release.
11. **Tag and checksums** — tagged `v0.1.0`; checksums below.

## Propagation Matrix (optional `implementation` binding)

| Consumer | Decision |
| --- | --- |
| Domain model | Updated: `ReasoningRecallDefinition`/`TransferPracticeDefinition` gain optional `implementation`. |
| Loader/schema | Updated: optional slug field validated against declared implementation keys; negative fixture + test added. |
| JSON schema | Updated: optional `implementation` on both item types; `aspect` now required to match the loader. |
| Valid fixtures | Updated: `graph/bfs` and `search/binary-search` declare the binding. |
| Core practice options | Updated: labels/language resolve the bound variant; session identity unchanged (`practice_id`). |
| Authoring | Updated: output schema, stage prompts, coverage check per variant, rubric rule. |
| Persistence/protocol | Unaffected: attempts and checkpoints key on `practice_id`. |
| Clients (Web, VS Code) | Unaffected: options render by label; handshake golden unchanged. |
| Docs | Updated: practice-engine, template-system, ADR 0013, README, roadmap. |

## Checksums (SHA-256)

```text
5e69f63b3a37a40fbde63671b5434ca12a6b0c77ca274bcf6eb08f2cffc9737b  gewu-algorithm-0.1.0.vsix
eca79229ee482a5c715813a79fbd21f8b2e8dfaf80f049506f493ebb416cecf1  gewu (linux x86_64)
b6ea67380e0f0ba3c132776a7167839a4eb8d6fbc6384cdf270f0a7fb6cf441f  pack (linux x86_64)
196af4fa23d464f3cf6d5f92b0bad954a7df41fbf71f1ecb4e09b22caf3f6cce  validate (linux x86_64)
```
