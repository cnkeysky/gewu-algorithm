# Practice Content Contracts

## Purpose

This document defines the platform-independent content boundaries for GEWU
practice modes. It prevents presentation details, provider output, and broad
learning labels from becoming unstable domain behavior.

The original progression is represented as:

```text
guided code reconstruction
        -> independent code reconstruction
        -> execution-flow reconstruction
        -> reasoning reconstruction
        -> transfer to a reviewed new case
```

Clients may render these activities differently, but they consume the same
content, events, states, and attempt facts.

## Shared Contract

Every practice definition belongs to one `AlgorithmUnit` revision and declares
enough reviewed content to start without a provider. A session records:

- unit, revision, practice mode, and selected implementation or case;
- practice-engine and scoring versions;
- deterministic events and terminal state;
- assistance requested or consumed separately from correctness;
- elapsed-time facts without making wall-clock time part of state transitions;
- whether qualitative review is pending.

The same revision owns the complete learner-facing Markdown problem statement.
Every mode displays that statement from its `SessionView`; checkpoint replay is
rejected if the stored revision no longer matches available content. A mode,
implementation variant, or practice ID may change the exercise projection but
must never substitute a different problem statement.

An LLM may draft content or provide optional feedback. It does not own session
completion, immutable attempt creation, or publication state.

## Code-Oriented Practice

`shadow_typing` and `code_recall` share text normalization, source selection,
editing events, progress facts, and terminal lifecycle primitives. They remain
distinct modes because they have different learning objectives and assistance
contracts.

### Shadow Typing

The learner reconstructs a canonical implementation while progressive target
guidance is available. Exactness follows the selected implementation's declared
normalization contract.

### Code Recall

The learner reconstructs a canonical implementation with substantially reduced
or absent code guidance. One definition selects an implementation and one
reviewed assistance policy:

| Policy | Reviewed content exposed to the learner |
| --- | --- |
| `skeleton` | Structural code that preserves selected declarations or control-flow boundaries |
| `comments` | Natural-language implementation cues without the missing target code |
| `keywords` | Ordered or grouped algorithm and language keywords |
| `cloze` | Explicit target regions are hidden while reviewed surrounding code remains visible |
| `none` | No target code guidance |

These policies are serialized configuration values, not practice modes. A
client cannot infer hidden regions from syntax highlighting or editor layout;
the template must declare the reviewed assistance content deterministically.

Stage 4 defines and validates this content. Stage 5 defines the corresponding
event state machine and scoring behavior.

## Flow Recall

The learner reconstructs reviewed ordered execution steps. Stable step IDs are
machine identity, not required answer text. Prompts, concepts, and accepted
aliases belong to content; revealing a prompt is recorded as assistance.
Flow Recall must not require one exact sentence or exact tone. Deterministic
acceptance is based on the ordered step plus reviewed aliases and required
concepts. Variations in connective words, tense, or natural-language style are
accepted when the declared concepts are covered. A response that needs
interpretation remains eligible for human or optional model feedback, not an
invented deterministic score.

## Reasoning Recall

Each prompt targets one explicit reasoning aspect:

- `mechanism`;
- `invariant`;
- `trade_off`;
- `boundary`;
- `failure_condition`.

The definition includes required reviewed concepts and may include accepted
expressions. Deterministic matching can establish only declared concept facts.
Answers needing interpretation receive a pending-review outcome rather than an
invented exact score.

The current content contract represents these fields as an `aspect`, `prompt`,
required `concepts`, and optional `aliases`.

## Transfer Practice

A transfer case declares:

- the reviewed source pattern;
- a new problem or scenario;
- expected transferable structure;
- material differences from the source case;
- boundaries or failure conditions;
- reviewed concepts and optional accepted expressions.

The current content contract represents these as `pattern`, `new_case`,
`prompt`, `concepts`, `transfers`, `differences`, and `boundaries`.

Completing an interaction and judging the quality of transfer are separate
facts. Optional model feedback cannot silently convert a pending review into a
validated learning result.

## Progression and Presentation

The typical progression is Shadow Typing, Code Recall, Flow Recall, Reasoning
Recall, and Transfer Practice. It is a recommendation policy, not a hard-coded
client navigation sequence. Users may start an available mode directly.

The core owns mode availability, session state, assistance facts, completion,
and recommendations. Clients own input translation, focus, accessibility,
localization, layout, editor decorations, and confirmation dialogs.

## Generation Boundary

Template generation begins only from versioned task contracts. Generated output
is parsed as untrusted draft content, validated structurally and semantically,
and reviewed explicitly before publication. Raw conversation text and provider
responses are not runtime practice definitions.
