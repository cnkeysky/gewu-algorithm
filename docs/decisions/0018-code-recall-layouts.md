# ADR 0018: Structured Code Recall Layouts

- Status: accepted
- Date: 2026-08-06

## Decision

Keep `code_recall` as the single practice mode and represent
`full_recall`, `comment_guided`, `comment_to_code`, and `cloze` as reviewed
layouts selected by `practice_id`. Implement them with one Core-owned
structured code-recall engine based on fixed regions and editable slots.

Move the meaning of comments out of the generic assistance enum. Assistance
controls hint exposure; layout controls what the learner must reconstruct.

## Rationale

These activities share canonical code, deterministic edit validation,
checkpointing, attempt facts, and review progression. Separate top-level modes
would duplicate lifecycle and persistence contracts. They nevertheless remain
distinct layouts because they train different cognitive operations and have
different editable regions.

The slot model avoids assuming that one comment maps to one source line. It also
gives the Core an explicit boundary for deletion, paste, completion, and future
reviewed alternatives.

## Consequences

- Existing `comments` scaffold behavior remains the schema-v1 transport for
  intrinsic comment content; structured layouts do not count it as a reveal.
- New layouts require schema, protocol, persistence, and replay tests before
  client integration.
- Exact canonical matching remains the initial deterministic policy; semantic
  equivalence is a separate reviewed-content problem.
- Web and Core now ship all structured layouts; native editor adapters remain
  downstream clients of this stable contract.
