# Project Origin

`gewu-algorithm` originated from a discussion about editor-based shadow typing for algorithm implementations. The idea expanded from code imitation into a progressive practice model:

```text
Code -> Flow -> Thinking -> Transfer
```

Reviewing Project-GEWU showed that this sequence needs stronger context and lifecycle semantics. In this repository the model therefore includes position, problem, current understanding, boundaries, evidence, validation, revision, and review.

This phrase is retained only as historical context. The normative internal practice-mode values are `shadow_typing`, `flow_recall`, `code_recall`, `reasoning_recall`, and `transfer_practice`; see [domain terminology](../architecture/terminology.md).

The original conversation is background material, not a normative specification. Product behavior is defined by the versioned requirements, architecture documents, schemas, tests, and ADRs in this repository.

## Relationship to Project-GEWU

[Project-GEWU](https://github.com/cnkeysky/Project-GEWU) remains the source for the general cognitive framework philosophy. This project specializes that philosophy for algorithm learning without copying every general-purpose record field into every practice interaction.

The specialization follows three rules:

1. preserve the intent of position, problem, relationship, transfer, validation, and revision;
2. use algorithm-specific data structures and deterministic practice modes where appropriate;
3. avoid turning the general philosophy into a mandatory form that users must always complete.
