# Domain Terminology

This document is the normative vocabulary for product requirements, schemas, protocols, Rust types, TypeScript types, persistence, telemetry, and user-facing labels.

## Naming Layers

The project distinguishes three naming layers:

| Layer | Example | Rule |
| --- | --- | --- |
| Domain concept | `ShadowTyping` | Rust and TypeScript type or enum variant in language-native style |
| Serialized value | `shadow_typing` | Stable lowercase `snake_case` used in schemas, protocol messages, and storage |
| Display label | `Shadow Typing` | Localizable user-facing text; never used as a persisted identifier |

Display wording may evolve without migrating stored data. Serialized values require compatibility review.

## Practice Modes

| Domain variant | Serialized value | Display label | Definition | Status |
| --- | --- | --- | --- | --- |
| `ShadowTyping` | `shadow_typing` | Shadow Typing | Reconstruct one selected canonical implementation while progressive visual guidance remains visible | MVP |
| `FlowRecall` | `flow_recall` | Flow Recall | Reconstruct reviewed execution states or steps without requiring exact prose | MVP |
| `CodeRecall` | `code_recall` | Code Recall | Reconstruct a selected implementation with substantially reduced or absent code guidance | Content contract in Stage 4; engine in Stage 5 |
| `ReasoningRecall` | `reasoning_recall` | Reasoning Recall | Reconstruct why an approach works, including state, invariant, trade-offs, and failure conditions | Content contract in Stage 4; engine in Stage 6 |
| `TransferPractice` | `transfer_practice` | Transfer Practice | Apply a reviewed pattern to a new case and identify what transfers, what differs, and where it fails | Content contract in Stage 4; engine in Stage 6 |

### Terms Not Used as Mode Identifiers

- `code` is a content layer, not a sufficiently precise mode. Use `shadow_typing` or `code_recall`.
- `flow` is a content concept. Use `flow_recall` for the practice mode.
- `thinking` is too broad and has no stable scoring contract. Use `reasoning_recall` when the activity reconstructs reasons and invariants.
- `explanation` is an answer or content form, not a mode. A `reasoning_recall` response may contain an explanation.
- `transfer` is a learning objective. Use `transfer_practice` for the interaction.

## Content Terms

| Term | Definition |
| --- | --- |
| `AlgorithmUnit` | Versioned reusable learning content for one stable algorithm concept or pattern |
| `ImplementationVariant` | One named, canonical implementation selected for code-oriented practice |
| `ExecutionFlow` | Reviewed states or steps describing how an implementation or algorithm progresses |
| `ReasoningPrompt` | A question targeting mechanism, invariant, trade-off, boundary, or failure condition |
| `TransferCase` | A new case used to test whether a reviewed pattern can be applied with its differences stated |
| `Counterexample` | A case that refutes or narrows a tempting rule or applicability claim |
| `ContentPack` | A versioned distributable collection of `AlgorithmUnit` revisions |

## Session Terms

| Term | Definition |
| --- | --- |
| `PracticeSession` | Mutable active state for one unit revision, variant, mode, and configuration |
| `PracticeEvent` | Deterministic input applied to a session state |
| `PracticeAttempt` | Immutable terminal record created when a session completes or stops |
| `HintUsage` | Facts describing which assistance was explicitly revealed or consumed |
| `ScoringVersion` | Version identifying how attempt facts are converted into derived scores |

Local persistence of `PracticeAttempt` belongs to the MVP. Platform-independent
review scheduling and progression recommendations are planned for Stage 8.

## Historical Phrase

The originating discussion used `Code -> Flow -> Thinking -> Transfer`. It remains useful as project history, but it is not a valid internal enum set. The normative mapping is:

```text
Code      -> shadow_typing or code_recall
Flow      -> flow_recall
Thinking  -> reasoning_recall
Transfer  -> transfer_practice
```
