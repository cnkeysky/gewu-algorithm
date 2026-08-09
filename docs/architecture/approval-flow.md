# Approval Flow and State Transitions

The authoring workbench treats approval as a layered gate, not a single click:
an automated LLM gate approves content, an optional LLM acceptance gate can
publish it, and **human approval is always superior** — it can upgrade an
LLM-approved unit and every published unit can be corrected through a new
revision.

## States

| Status | Meaning | Label |
| --- | --- | --- |
| `queued` | Draft created, not generated | Queued |
| `generated` | Artifact generated | Generated |
| `validated` | Deterministic Rust contract validation passed | Contract valid |
| `needs_revision` | One or more LLM pre-review roles failed | Needs revision |
| `revision_requested` | Rolled back; awaiting regeneration with feedback | Awaiting regeneration |
| `llm_reviewed` | All three pre-review roles passed (content gate) | LLM approved |
| `accepted` | Published; approval tier recorded in the audit trail | Human approved / LLM approved |
| `failed` | Generation or contract validation failed; error recorded | Generation failed |

`failed` is a terminal error state outside the approval flow: it cannot enter
validation, review, or approval. The only transitions are retry (generate),
regenerate (rollback), or delete. The stored error message is shown in the
Drafts list and is the diagnostic record for a failed run.

Accepted drafts without a recorded acceptance tier default to **Human
approved** (historically acceptance required a human); the upgrade button
only appears for units whose approval tier is `llm_acceptance`.

## Backend guarantees

The workbench API is the source of truth for the state machine — the UI only
mirrors it. Every endpoint rejects invalid transitions:

- `generate` only from `queued` / `revision_requested` / `failed`;
- `validate` only from `generated`;
- a failed `generate` or `validate` marks the draft `failed` and records the
  error (the backend is the source of truth; the UI only mirrors it);
- `reviews` only from `validated` (or `needs_revision` while completing the
  remaining roles for the same artifact);
- `acceptance` (LLM acceptance gate) from any artifact whose status is
  `validated` / `llm_reviewed` / `needs_revision`; a **pass** is decisive —
  the draft publishes with the **LLM approved** label and no human step, and
  the audit trail records `llm_acceptance` with the gate's rationale. The
  pre-review roles are advisory for this path; the gate reads the artifact and
  any findings itself. A **needs_revision** verdict moves the draft to
  `needs_revision` (from `validated` / `llm_reviewed`), so the UI offers
  revision before another attempt. The web workbench exposes the gate as the
  **LLM approve** action on those states; the batch exposes it via
  `--llm-approve`;
- `accept` without the gate only from `llm_reviewed`, `needs_revision` with an
  explicit `override` plus rationale, or `validated` with a human revision;
  the human upgrade of an already-`accepted` unit is always allowed and is
  superior to the LLM tier;
- `rollback` (regenerate) only from `generated`, `llm_reviewed`,
  `needs_revision`, or `failed`.

## Transitions

```text
queued ──generate──▶ generated ──validate──▶ validated ──pre-review──▶ llm_reviewed
   ▲                      ▲                        │  (any role fails)
   │                      │                        ▼
   │                      │                   needs_revision
   │                      │                        │
   │                      │      ┌─────────────────┘
   │                      │      │  (Regenerate: rollback + regenerate with feedback)
   │                      │      ▼
   └──── regenerate ── revision_requested

llm_reviewed / needs_revision ──accept──▶ accepted (published)
validated / llm_reviewed / needs_revision ──LLM acceptance gate (pass)──▶ accepted (LLM approved)
accepted ──human upgrade──▶ Human approved   (human > llm; rationale recorded)
accepted ──fork (Extend unit)──▶ new draft ──fix──▶ accept ──▶ new revision (r2)

queued ──generate failure──▶ failed
generated ──validate failure──▶ failed
failed ──retry generate──▶ generated
failed ──rollback──▶ revision_requested
failed ──delete──▶ (removed)
```

## Approval hierarchy

1. **LLM approved** — the lowest approval tier. It means either the pre-review
   content gate passed (`llm_reviewed`) or an automated acceptance gate
   published the unit (`llm_acceptance` recorded in the audit trail). An
   LLM-approved published unit is not final. The acceptance gate requires a
   Rust-validated artifact, reads the artifact and any advisory pre-review
   findings itself, and its pass is decisive for publication — the pre-review
   roles are not a prerequisite for this path.
2. **Human approved** — the final tier. A human can upgrade an
   LLM-approved published unit by recording an explicit `human_acceptance`
   review with a rationale; the unit stays published and its label changes
   from "LLM approved" to "Human approved". Human approval is never
   downgraded by automation.

## Correcting an approved unit

Approval is not a dead end. Errors found after publication are fixed through
a new revision:

- **Revise unit** (fork) on an accepted draft creates a new editable draft for
  the same unit id; fix the content (or extend modes), run generate →
  validate → pre-review, then accept. The new revision is published and the
  previous one stays in the unit history.
- **Edit an accepted draft directly** (click the row, change the form, save):
  the same unit id is preserved, so submitting publishes a new revision.
- The **audit trail** records every review and acceptance verdict, the
  approver role (`human_acceptance` / `llm_acceptance`), and the acceptance
  rationale, so who approved what is always traceable.

Post-approval problems are unavoidable — even a human-approved unit can later
turn out to have a wrong edge case or complexity claim. The revision model is
the answer: published units are immutable in place, corrections always land
as a new revision (fork → fix → re-approve), and because every revision is
kept, a bad fix can be corrected again or the previous revision restored by
forking it. Practice consumes the latest published revision, so a known-bad
revision should be replaced promptly.
