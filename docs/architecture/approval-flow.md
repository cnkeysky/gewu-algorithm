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

## Artifact content lifecycle (manifest `status` / `validation`)

The workflow states above live on the draft row. The artifact manifest has a
separate content lifecycle that follows the Rust `ContentStatus` chain
(`draft` → `reviewed` → `validated`; later `revised` / `deprecated`), and it
must advance with the real checks — stamping is fail-hard and publishing is
structurally guarded:

- **`draft`** — model output; the output schema pins `validation.*` to
  `pending` and the status to `draft`.
- Deterministic Rust contract validation passed → `validation.schema` and
  `validation.code` become `passed` (status stays `draft`: nothing has been
  content-reviewed yet).
- The LLM acceptance gate passes, or a human accepts → the artifact is
  content-reviewed: `status` becomes `reviewed` and
  `validation.content_review` / `validation.transfer_review` become `passed`.
- Publishing → `status` becomes `validated`. The publish step refuses any
  artifact whose status is not `validated` or whose four validation stages
  are not all `passed`, so an unstamped artifact can never be served.

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
- `PATCH` (reuse/reset to `queued`) only for non-accepted drafts: `accepted`
  is terminal, so resetting it is refused with 409 — a unit can only be
  revised through `/fork`. Callers may pass `expectedStatus` (the status they
  observed) and a mismatch is also refused with 409, so a stale or concurrent
  client (e.g. an old batch process with an outdated index) can never clobber
  a draft that changed underneath it.
- LLM-backed operations (`generate`, `acceptance`, `reviews`) are serialized
  with leases on a `claims` table (unique key = draft + operation + review
  role, with an expiry): only one worker can run the same operation on the
  same draft, so concurrent runs cannot double-spend the model quota, and a
  crashed worker's lease is reclaimed after it expires. The three pre-review
  roles remain concurrent because their claim keys differ by role.

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
- **Edit an accepted draft directly** is intentionally blocked: the form
  refuses to load an accepted draft and the API rejects any reset of it. The
  only path is **Revise unit** (fork), which preserves the unit id and creates
  a new editable draft whose accept publishes the next revision.
- The **audit trail** records every review and acceptance verdict, the
  approver role (`human_acceptance` / `llm_acceptance`), and the acceptance
  rationale, so who approved what is always traceable.

Post-approval problems are unavoidable — even a human-approved unit can later
turn out to have a wrong edge case or complexity claim. The revision model is
the answer: published units are immutable in place, corrections always land
as a new revision (fork → fix → re-approve). The published content root serves
**only the latest revision** of each unit (the core keeps the newest per unit
id); earlier revisions are not lost — every accepted draft in the authoring
store is one revision with its artifact retained, so a previous revision can
be restored by forking that draft and republishing it as a new revision.
Practice consumes the latest published revision, so a known-bad revision
should be replaced promptly.
