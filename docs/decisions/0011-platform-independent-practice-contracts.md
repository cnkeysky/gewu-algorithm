# ADR 0011: Define Practice Content Independently of Clients

- Status: accepted
- Date: 2026-08-05

## Context

The first MVP validated Shadow Typing and Flow Recall through VS Code. The
Project-GEWU progression also requires reduced-guidance code reconstruction,
reasoning recall, and transfer practice. If these activities are implemented as
editor features first, input behavior and layout will accidentally become the
learning contract and other clients will require a rewrite.

The terms `thinking`, `comments typing`, and `cloze` are also too broad or too
specific to serve as independent persisted modes. They need precise content and
scoring boundaries.

## Decision

Practice definitions, session transitions, assistance facts, completion, scoring
facts, and progression inputs belong to the Rust core and versioned content
schema. Clients only translate external input and render core state.

The stable practice modes remain:

```text
shadow_typing
code_recall
flow_recall
reasoning_recall
transfer_practice
```

Skeleton, comments, keywords, cloze, and no-code guidance are assistance
policies under `code_recall`, not additional modes. Qualitative answers may be
marked pending review, but a provider cannot own completion or publication.

The schema additions are optional within the pre-v1 `AlgorithmUnit` contract so
existing Shadow/Flow units remain loadable. A future schema major version may
make new practice content mandatory only after migration rules and a complete
content set exist.

## Consequences

- Core tests and a CLI can validate and exercise learning behavior without an
  editor, network, or provider.
- VS Code, Zed, Web, and future clients share the same mode semantics.
- Content contracts must be specified before live LLM generation is connected.
- Stage 4 defines and validates content; Stage 5 and Stage 6 implement the
  corresponding state machines.
- Schema fields that cannot yet be scored deterministically must carry explicit
  review semantics rather than implying automatic correctness.
