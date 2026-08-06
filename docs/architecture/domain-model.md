# Domain Model

## Aggregate Boundaries

### AlgorithmUnit

An `AlgorithmUnit` is the publishable learning-content aggregate. It contains:

- stable ID and revision;
- lifecycle status;
- position, problem, scope, and prerequisites;
- current reviewed understanding and alternatives;
- implementation variants;
- flow and state models;
- patterns, relationships, boundaries, and counterexamples;
- practice activity definitions;
- provenance, license, and validation metadata;
- revision links.

An `AlgorithmUnit` is not a user's personal learning record. It describes reusable content and how that content can be practiced.

### PracticeSession

A session is an active deterministic state machine:

```text
Created -> Active -> Completed
                  -> Stopped
                  -> Invalidated
```

It captures the selected unit revision, implementation variant, mode, engine version, configuration, current state, and input event sequence needed for reliable scoring.

### PracticeAttempt

An attempt is an immutable result created when a session completes or stops. It records facts about the interaction; later review calculations must not rewrite it.

Derived summaries may be rebuilt from attempts.

### ReviewState

Review state is user-specific and mutable. It references attempts and records the current scheduling decision. It is separate from reusable `AlgorithmUnit` content.

## Identity and Revision

- Unit IDs are stable lowercase ASCII identifiers such as `graph.bfs`.
- A content revision is a positive integer within one stable ID.
- Published revisions are immutable.
- `problem.statement`, implementations, and practice projections are one immutable revision snapshot; changing any of them requires a new revision.
- Corrections create a new revision and link through `supersedes`.
- Attempts always reference an exact unit ID and revision.
- Active and resumed sessions expose the statement from that exact revision. A client must not re-resolve a statement by title, mode, or an unversioned ID.
- Lifecycle state does not replace revision history.

## Implementation Variants

An algorithm may have multiple valid implementations. Each variant has a stable key and declares:

- language;
- source file;
- formatting and line-ending policy;
- intended purpose, such as `teaching`, `concise`, or `iterative`;
- reviewed strategy and asymptotic complexity when available;
- runtime assumptions;
- contained test references. Templates never carry executable validation commands.

Variants belong to one unit only while they share the same problem contract,
core mechanism, reasoning target, and execution flow. A materially different
algorithmic approach, such as Kahn versus DFS topological sorting, is a separate
related `AlgorithmUnit`; duplicating every practice mode for each approach would
hide that conceptual difference and create maintenance drift.

Shadow Typing compares against one selected variant. It makes no claim about other correct solutions.
Code Recall also selects a variant by key. Flow Recall, Reasoning Recall, and
Transfer Practice remain unit-level learning content rather than being copied
into separate mode-specific templates.

Practice mode names and their stable serialized values are defined in [domain terminology](terminology.md). Bare values such as `code`, `flow`, `thinking`, and `transfer` are not valid internal mode identifiers.

## Relationships

Relationships are directed and must include a reason and, where relevant, a boundary:

```text
depends_on
influences
analogous_to
contrasts_with
composes_with
generalizes
specializes
supersedes
```

The vocabulary should remain small. A new relationship type requires demonstrated use across several units and a schema review.

## Validation State

Content lifecycle and validation evidence are related but distinct:

| Status | Meaning |
| --- | --- |
| `draft` | Incomplete or unreviewed content |
| `reviewed` | Human-reviewed structure, reasoning, provenance, and boundaries |
| `validated` | Reviewed content with all declared executable and content checks passing |
| `deprecated` | Still readable but should not be selected for new practice |
| `revised` | Replaced by a newer revision |

Validation records what was checked, with which tool or reviewer, and when. A single boolean `verified` is insufficient.

## Errors

Domain errors should be typed and actionable. Expected categories include:

- invalid content;
- unsupported schema or protocol version;
- invalid session transition;
- input mismatch;
- unavailable variant;
- persistence failure;
- provider failure;
- permission or privacy refusal.

Expected user or content errors must not be represented by panics.
