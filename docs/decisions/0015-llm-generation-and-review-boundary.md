# 0015: Keep LLM Generation and Review Behind Deterministic Gates

Status: Accepted

## Context

Template authoring must handle multiple implementation variants and all GEWU
practice modes without duplicating units. LLM responses may contain prose,
truncated JSON, invented fields, unsafe paths, incorrect code, or unsupported
lifecycle claims. LLM4AD demonstrates useful ideas around separating sampling,
content extraction, isolated evaluation, and scoring, but its heuristic function
trimming and research-oriented execution model are not GEWU content contracts.

## Decision

Generate one complete `AlgorithmUnit` envelope using strict whole-response JSON.
Reject markdown wrappers, ambiguous extraction, unknown fields, truncation, and
uncontained files. Validate in staging through trusted shape checks, bounded
language-specific tests, and the Rust template loader before retaining a draft.

Keep implementation variants inside one unit only when they share the problem,
mechanism, and reasoning target. Practice modes are definitions within that
aggregate, not separate generated templates.

LLM review uses versioned role-specific rubrics and immutable artifact hashes.
Reviewers return findings and repair handoffs. They never modify, accept, or
publish the reviewed draft. Deterministic checks run before model review; a
human or explicitly authorized publication workflow remains the final gate.

## Consequences

- Provider responses remain untrusted and replaceable.
- Repair can be delegated to another model without granting publication rights.
- Reviewer disagreements and source/licensing decisions require human action.
- GEWU borrows evaluation principles from LLM4AD without copying its parser,
  provider client, retry loop, or evaluator implementation.
