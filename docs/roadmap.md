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

Status: complete as of 2026-08-05. The host-free checks and the real VS Code
Extension Development Host checklist passed in the WSL development environment.

- compare native document, custom document, and Webview approaches;
- test Undo/Redo, multi-cursor, formatting, input methods, Tab, and external edits;
- select the lowest-complexity reliable design in a new ADR.

The current evidence selects a native editor with a dedicated untitled practice document and decorations. See [the spike report](architecture/vscode-interaction-spike.md), [the manual checklist](development/vscode-spike-checklist.md), and [ADR 0007](decisions/0007-vscode-native-practice-document.md).

Exit when repeated sessions do not corrupt documents or engine state and the manual host checklist passes.

## Stage 3: Local MVP

Status: complete as of 2026-08-05. The local Rust core, JSON-RPC host,
deterministic `flow_recall`, local history, selectable checkpoint collection,
native Shadow Typing client, and structured Flow Recall panel passed automated
and real extension-host validation.

- package the core with the VS Code extension;
- implement serialized `shadow_typing` and `flow_recall` modes;
- persist local attempts;
- add onboarding, accessible feedback, and deletion controls;
- persist a selectable collection of interrupted checkpoints while allowing only
  one active editor interaction at a time;
- validate several real units through repeated use.

Exit according to [MVP criteria](product/mvp.md).

## Stage 4: Core Learning Contracts and Template Schema

Status: complete as of 2026-08-05.

- specify platform-independent content, assistance, event, and scoring contracts
  for all reserved practice modes;
- model progressive code assistance without turning every presentation variant
  into a persisted practice mode;
- extend `AlgorithmUnit` and its semantic validation for `code_recall`,
  `reasoning_recall`, and `transfer_practice`;
- add representative valid and invalid fixtures for the new contracts;
- document compatibility rules before exposing the contracts through clients or
  generation providers.

Exit when the Rust core can load and validate representative content for all
five practice modes without an editor, network connection, or LLM provider.

## Stage 5: Core Progressive Code Practice

Status: complete as of 2026-08-05. The deterministic session, host-free core
service, protocol DTOs, practice-definition selection, checkpoint replay, and
local attempt facts are implemented. Editor integration and broader progression
behavior remain deferred.

- implement deterministic `code_recall` sessions over the shared code-practice
  foundation;
- support reviewed skeleton, comment, keyword, cloze, and absent-code assistance;
- keep assistance usage separate from correctness, completion, and elapsed-time
  facts;
- test replay, Unicode, line endings, restart, stop, and terminal attempt
  creation without an editor;
- expose the mode through core application services and a host-free CLI harness.

Exit when progressive code practice can be replayed and scored deterministically
through core tests and the CLI.

## Stage 6: Core Reasoning and Transfer Practice

Status: complete as of 2026-08-05. Both modes now run through the offline
practice engine and Core/Protocol boundary with deterministic transitions,
checkpoint replay, and immutable attempt facts.

- implement `reasoning_recall` against reviewed concepts, invariants,
  trade-offs, boundaries, and failure conditions;
- implement `transfer_practice` against reviewed cases, transferable structure,
  differences, and limits;
- define deterministic attempt facts and explicit human-review boundaries for
  answers that cannot be scored mechanically;
- keep live model evaluation optional and outside completion-state ownership.

Exit when both modes are usable offline with deterministic session transitions
and stable attempt facts.

## Stage 7: Core Template Authoring Pipeline

- define typed, provider-neutral drafting tasks aligned with the Project-GEWU
  philosophy and the implemented `AlgorithmUnit` contracts;
- add deterministic scaffold, validate, and local-draft CLI workflows before
  connecting a live provider;
- parse structured generation output into ordinary manifest and source files;
- validate schema, semantics, source containment, and executable code where
  practical;
- record task versions, selected-input hashes, provider metadata, and review
  state without committing raw private prompts or responses;
- require explicit human review before generated content can enter an official
  content pack.

Exit when a fake provider can exercise the full deterministic pipeline and at
least two contrasting local draft units can be generated, validated, reviewed,
and loaded without any editor dependency.

## Stage 8: Review, Progression, and Retention

- derive progression recommendations from attempts and assistance dependence;
- add minimal delayed-review scheduling through a platform-independent policy;
- measure reconstruction after delay across practice modes;
- allow user choice to override recommendations without corrupting history;
- remove attempt and content fields that do not change decisions;
- document inconclusive and negative findings.

Exit when the same attempt history produces the same review recommendations in
core tests and at least one host-free client.

## Stage 9: Content Lifecycle and Distribution

- define checksummed content-pack manifests and compatibility checks;
- harden draft, review, validation, revision, and deprecation workflows;
- evaluate extracting `gewu-algorithm-templates` only after the schema and
  contribution cadence satisfy the documented split criteria;
- add knowledge relationships only after they improve real recommendations.

## Stage 10: Client and Editor Expansion

- adapt the completed core modes to VS Code without redefining their scoring or
  persistence behavior;
- revisit Zed, web, and synchronization using current platform capabilities;
- treat client-specific interaction polish as adapter work rather than a blocker
  for platform-independent core development.
