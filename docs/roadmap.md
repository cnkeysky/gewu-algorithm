# Roadmap

The roadmap is evidence-driven. Dates may guide planning, but each stage exits only when its stated uncertainty has been reduced.

## Stage 0: Repository and Model Baseline

Status: complete as of 2026-08-04. The schema remains pre-v1 and may still evolve through explicit compatibility review.

- establish requirements, architecture, ADRs, and engineering standards;
- draft the `AlgorithmUnit` schema;
- create representative valid and invalid fixtures;
- review privacy, licensing, and provenance defaults.

Exit when one BFS unit and one contrasting unit can be represented without arbitrary required fields.

## Stage 1: Practice Engine Spike

Status: complete as of 2026-08-04.

- implement deterministic Shadow Typing state transitions;
- define normalization and editor mutation behavior;
- expose the engine through a test harness or CLI;
- test deletion, paste, replacement, terminal states, and replay determinism.

Exit when event replay is deterministic and attempt facts are stable.

## Stage 2: VS Code Interaction Spike

Status: in progress; the host-free TypeScript spike and design decision are complete, but the real extension-host checklist remains.

- compare native document, custom document, and Webview approaches;
- test Undo/Redo, multi-cursor, formatting, input methods, Tab, and external edits;
- select the lowest-complexity reliable design in a new ADR.

The current evidence selects a native editor with a dedicated untitled practice document and decorations. See [the spike report](architecture/vscode-interaction-spike.md), [the manual checklist](development/vscode-spike-checklist.md), and [ADR 0007](decisions/0007-vscode-native-practice-document.md).

Exit when repeated sessions do not corrupt documents or engine state and the manual host checklist passes.

## Stage 3: Local MVP

- package the core with the VS Code extension;
- implement Code and Flow modes;
- persist local attempts;
- add onboarding, accessible feedback, and deletion controls;
- validate several real units through repeated use.

Exit according to [MVP criteria](product/mvp.md).

## Stage 4: Review and Retention Experiment

- add minimal delayed-review prompts;
- measure prompt dependency and reconstruction after delay;
- remove attempt fields and content fields that do not change decisions;
- document inconclusive and negative findings.

## Stage 5: Optional LLM Drafting

- implement typed task and provider contracts;
- add explicit data-disclosure and secret-storage flows;
- validate structured outputs and executable code;
- require human review for publication.

## Stage 6: Content Ecosystem and Additional Clients

- evaluate extracting `gewu-algorithm-templates`;
- define signed or checksummed content-pack releases;
- add knowledge relationships only after they improve real recommendations;
- revisit Zed, web, and synchronization using current platform capabilities.
