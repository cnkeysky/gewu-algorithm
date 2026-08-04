# Minimum Viable Product

## Hypothesis

A dedicated `shadow_typing` session with progressive visual guidance can help a learner move from recognizing an implementation to reconstructing it, while a separate `flow_recall` session can expose whether the learner understands the execution sequence.

The MVP validates product and interaction assumptions. It does not validate the complete long-term learning philosophy.

## Included

- Rust domain, template, practice, and protocol foundations;
- versioned `AlgorithmUnit` schema;
- local built-in or fixture content;
- one Python BFS unit and at least one additional contrasting unit;
- exact-match `shadow_typing`;
- an ordered `flow_recall` mode with a structured panel, natural-language answers, and optional prompt reveal;
- VS Code integration;
- CLI or test harness for exercising the same core logic;
- local attempt persistence;
- deterministic scoring for accuracy, completion, elapsed time, and prompts used;
- schema, unit, protocol, and VS Code integration tests.

## Explicitly Excluded

- arbitrary solution correctness checking;
- online judge execution;
- automatic import from commercial problem platforms;
- cloud synchronization and accounts;
- public template marketplace;
- automatic publishing of LLM output;
- knowledge-graph recommendations;
- full spaced-repetition scheduling;
- mobile or web applications;
- feature parity with Zed;
- collaborative or competitive features.

## Technical Spikes

For Shadow Typing, validate the native editor interaction through:

1. ordinary editor document plus decorations;
2. controlled virtual/custom document;
3. Webview-based practice editor only if native editor behavior cannot be made reliable.

Flow Recall uses a structured Webview because it requires persistent problem,
progress, and completed-step context rather than character-level editor events.

The spike must cover paste, multi-cursor edits, Undo/Redo, formatting, input methods, Tab, line endings, and external document modifications.

## Measurement

The MVP should record locally:

- unit and variant revision;
- practice mode;
- elapsed time;
- accepted and rejected input counts;
- correction count;
- prompts revealed;
- completion state;
- optional delayed-review result.

Typing speed may be displayed, but it is not the primary success measure.

## Exit Criteria

Proceed beyond the MVP only after:

- the editor interaction is reliable in repeated use;
- the core remains independent from VS Code;
- users can understand the difference between imitation and independent solving;
- the schema supports real examples without frequent incompatible changes;
- collected attempt fields demonstrate practical value;
- no required field exists only to make the template appear comprehensive.
