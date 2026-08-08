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

Accepted drafts without a recorded acceptance tier default to **Human
approved** (historically acceptance required a human); the upgrade button
only appears for units whose approval tier is `llm_acceptance`.

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
accepted ──human upgrade──▶ Human approved   (human > llm; rationale recorded)
accepted ──fork (Extend unit)──▶ new draft ──fix──▶ accept ──▶ new revision (r2)
```

## Approval hierarchy

1. **LLM approved** — the lowest approval tier. It means either the pre-review
   content gate passed (`llm_reviewed`) or an automated acceptance gate
   published the unit (`llm_acceptance` recorded in the audit trail). An
   LLM-approved published unit is not final.
2. **Human approved** — the final tier. A human can upgrade an
   LLM-approved published unit by recording an explicit `human_acceptance`
   review with a rationale; the unit stays published and its label changes
   from "LLM approved" to "Human approved". Human approval is never
   downgraded by automation.

## Correcting an approved unit

Approval is not a dead end. Errors found after publication are fixed through
a new revision:

- **Extend unit** (fork) on an accepted draft creates a new editable draft for
  the same unit id; fix the content, run generate → validate → pre-review,
  then accept. The new revision is published and the previous one stays in
  the unit history.
- **Edit an accepted draft directly** (click the row, change the form, save):
  the same unit id is preserved, so submitting publishes a new revision.
- The **audit trail** records every review and acceptance verdict, the
  approver role (`human_acceptance` / `llm_acceptance`), and the acceptance
  rationale, so who approved what is always traceable.
