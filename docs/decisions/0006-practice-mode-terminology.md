# ADR 0006: Use Precise Practice-Mode Terminology

- Status: accepted
- Date: 2026-08-04

## Context

The originating phrase `Code -> Flow -> Thinking -> Transfer` describes a useful learning progression but does not provide precise software contracts. `Thinking` is especially broad: it does not say whether a learner is explaining a mechanism, recalling an invariant, comparing trade-offs, or receiving model-generated feedback.

Using display labels or broad layer names as persisted enums would make input requirements, deterministic scoring, compatibility, and analytics ambiguous.

## Decision

Use these stable serialized practice-mode values:

```text
shadow_typing
flow_recall
code_recall
reasoning_recall
transfer_practice
```

Only `shadow_typing` and `flow_recall` belong to the MVP. The other values are reserved names and must not be implemented until their input and scoring contracts are specified.

Use `explanation` for an answer or content form, not as a practice-mode enum. Use localizable display labels independently from stored values.

## Consequences

- Schemas, protocols, storage, and telemetry share unambiguous identifiers.
- Historical product language needs an explicit mapping to normative terms.
- Renaming a display label does not require persisted-data migration.
- Adding a reserved post-MVP mode still requires requirements, scoring rules, and tests.
