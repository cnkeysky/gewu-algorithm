# Product Vision

## Problem

Algorithm learning commonly jumps from reading an explanation directly to solving a complete problem. Learners can recognize a solution while reading it but may be unable to reconstruct the state, invariants, control flow, or transferable pattern without the source material.

Existing typing tools primarily train input speed. Problem platforms primarily evaluate final solutions. `gewu-algorithm` focuses on the practice layer between recognition and independent problem solving.

## Vision

Help learners build reusable algorithmic thinking through deliberate, progressively reduced support rather than memorizing isolated solutions.

The product applies Project-GEWU's general principles to algorithm learning:

- locate an algorithm within a larger problem system;
- identify the problem it solves and the conditions under which it applies;
- state a current understanding before treating an explanation as final;
- connect implementation, state changes, invariants, and trade-offs;
- extract patterns only when they transfer across examples;
- test understanding through reconstruction, transfer, counterexamples, and results;
- preserve revisions when an explanation, implementation, or boundary changes.

## Product Principles

1. **Practice is deterministic.** Input validation, scoring, scheduling, and persistence do not depend on an LLM response.
2. **Generated content is a draft.** LLM output must be parsed, validated, tested, and reviewed.
3. **Templates are cognitive units.** Code is one component of an `AlgorithmUnit`, not the entire unit.
4. **Exact imitation and independent solving are different activities.** The product names and scores them separately.
5. **Local and private by default.** Practice history, user templates, source code, and credentials remain local unless the user explicitly exports or sends them.
6. **Evidence precedes expansion.** New modes and required fields are added only when real usage demonstrates value.
7. **Editors are clients.** Core learning behavior must remain reusable outside a specific editor.

## Intended Users

- learners who understand an editorial but cannot reproduce the implementation;
- learners building a reusable algorithm template library;
- experienced developers revisiting algorithms after a long interval;
- educators creating structured practice units;
- maintainers reviewing and publishing reusable algorithm content packs.

## Success

Success is not measured by the number of templates or generated explanations. The product should eventually demonstrate that users can:

- reconstruct an implementation with fewer prompts;
- explain the state and invariant without viewing the solution;
- retain the pattern after a delay;
- recognize when the pattern does not apply;
- transfer the pattern to a related problem;
- revise an earlier understanding when tests or counterexamples expose a flaw.
