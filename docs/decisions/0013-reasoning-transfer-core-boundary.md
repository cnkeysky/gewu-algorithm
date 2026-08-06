# ADR 0013: Deterministic Reasoning and Transfer Core Boundary

Status: accepted

## Context

Reasoning and transfer answers can contain prose whose quality is not safely
owned by an offline state machine. The core still needs replayable progress and
stable attempt facts without silently delegating completion to an LLM.

## Decision

`reasoning_recall` accepts a reviewed ID, alias, or all reviewed concept terms.
`transfer_practice` accepts all reviewed concepts, transfers, differences, and
boundaries. Both modes record prompt reveals, rejected answers, restarts,
elapsed time, and one immutable terminal attempt. `practice_id` selects the
reviewed definition and is persisted in checkpoints. Human or model feedback may
be added later, but cannot rewrite completion state or historical facts.
Both item types may bind a declared implementation variant through the optional
`implementation` field (absent means the unit's first implementation). The core
exposes the binding in practice options so multi-variant units surface distinct
facets; session identity remains the `practice_id`, so the field does not change
checkpoint or attempt semantics.

## Consequences

The modes are usable offline and deterministic through Core and stdio. The
matching rules are intentionally conservative and do not claim to score open-
ended explanation quality. Richer review remains a separate later layer.
