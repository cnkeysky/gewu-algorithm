# v0.1.9 Release Record

Release on 2026-08-08: layered approval with an explicit human-over-LLM
hierarchy, a backend-enforced state machine, and a coherent workflow display
across Drafts, Review history, and the artifact inspector. The Rust core
reports `0.1.9`; the JSON-RPC protocol stays v2.

## Changes since v0.1.8

### Layered approval

- **LLM approved** is the automated tier (pre-review content gate and/or the
  batch `--llm-approve` acceptance gate, recorded as `llm_acceptance`);
  **Human approved** is always superior. A human can upgrade an LLM-approved
  published unit with an explicit rationale, and the upgrade button only
  appears for units whose recorded tier is `llm_acceptance`.
- Acceptance rationales are persisted in the audit trail
  (`reviews.rationale`) and shown in Review history; accepted drafts without a
  recorded tier default to Human approved (the neutral "Approved" fallback is
  gone).
- The batch CLI's `accept` step defaults to the LLM approval gate
  (`--llm-approve provider:model`, deepseek default); `--auto-accept` remains
  the operator (human-tier) override. `--creator-models` rotates creator
  models across problems, and per-problem `provider`/`model` pins dispatch
  creation to different LLM APIs.

### Backend-enforced state machine

The workbench API is the source of truth for every transition: generate only
from queued/revision_requested, validate only from generated, reviews only
from validated (or needs_revision completing the remaining roles), accept
only from llm_reviewed / needs_revision with override / validated with human
revision / the human upgrade of accepted, and regenerate only from generated /
llm_reviewed / needs_revision. The guaranteed table is documented in
`docs/architecture/approval-flow.md`.

### Coherent workflow display

- Pipeline chips follow standard stepper semantics: completed steps green,
  current step a highlighted pill, upcoming steps gray (validated shows
  01/02 done, 03 current, 04 pending). "Contract valid" is the validated
  state whose next step is LLM pre-review.
- Draft statuses are coherent: `Awaiting regeneration` pairs with a
  Regenerate button; needs_revision approval reads "Approve anyway" in an
  override style; Regenerate never appears next to LLM pre-review.
- Review history is a read-only audit ledger: verdicts stack above a renamed
  **View report** button, and the shared artifact inspector is read-only
  everywhere except Drafts' needs_revision **Revise artifact** (published
  units are immutable in place; corrections go through **Revise unit** → new
  revision, with every revision kept).
- Approval rationales use an in-app modal instead of the browser prompt.
- Web LLM pre-review runs the three roles concurrently; a failing role no
  longer aborts the remaining reviews.

## Verification

- Rust gates (fmt, clippy, workspace tests), TypeScript unit suite, and the
  full Playwright suite (including the layout suite and the new artifact
  inspector read-only coverage) are green.
- Real DeepSeek verification: pre-review, the acceptance gate (pass with
  rationale), publication with `llm_acceptance`, and an override approval
  recording `human_acceptance` with a persisted rationale.
