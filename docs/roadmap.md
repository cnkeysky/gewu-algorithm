# Roadmap

The roadmap is evidence-driven. Dates may guide planning, but each stage exits only when its stated uncertainty has been reduced.

## Stage 0: Repository and Model Baseline

Status: complete as of 2026-08-04. AlgorithmUnit schema v2 and protocol v2 are the current contracts; the required Markdown problem statement is an intentional incompatible change with no v1 fallback.

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

Status: complete as of 2026-08-05. Provider-neutral generation contracts,
Pi-ai authoring integration, structured draft parsing, review-gated artifacts,
local draft persistence, and template-loader validation are covered by tests
with two contrasting fixture units.

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

Stage 7 follow-up completed on 2026-08-05: implementation variants now carry
reviewed strategy, complexity, assumptions, and contained test references;
DeepSeek generation uses strict whole-response JSON and staging validation; and
role-specific model review emits immutable-hash findings without publication
authority. Generation profiles now select multiple practice projections and
implementation variants without duplicating the canonical unit. The authoring
workbench boundary and local TypeScript/HTML/CSS direction are recorded in
[the workbench architecture](architecture/template-authoring-workbench.md) and
[ADR 0016](decisions/0016-template-authoring-workbench.md). The interactive
surface is implemented: drafts, staged generation (core, per code recall
layout, reasoning, transfer), deterministic validation, role review with a
documented human-override accept, immutable accepted revisions with a fork/new
revision flow, and a dev Core serving fixtures plus published units through
multiple content roots. Generation uses one algorithm-agnostic contract prompt;
problem-class prompt templates are intentionally not used (see
[template-system](architecture/template-system.md)). These authoring
capabilities remain independent of editor clients.

## Stage 8: Review, Progression, and Retention

Status: complete as of 2026-08-05.

- derive progression recommendations from attempts and assistance dependence;
- add minimal delayed-review scheduling through a platform-independent policy;
- measure reconstruction after delay across practice modes;
- allow user choice to override recommendations without corrupting history;
- remove attempt and content fields that do not change decisions;
- document inconclusive and negative findings.

The platform-independent `gewu-review` policy now groups terminal attempt facts
by unit, revision, and mode. Assistance dependence and rejected answers produce
high-priority one-day reviews; a clean repeated history produces a seven-day
progression recommendation; a single clean completion produces a three-day
delayed review. Interrupted-only histories produce no recommendation; only
completed material is scheduled. The
policy consumes only decision-relevant facts, returns stable recommendations,
and exposes user overrides as separate decisions without mutating attempt
history. `gewu review` is the host-free CLI surface for the policy.

Exit evidence: the same unordered attempt facts produce the same recommendation
set in core tests, and the CLI can project recommendations without an editor.

## Stage 9: Content Lifecycle and Distribution

Status: complete as of 2026-08-05.

- define checksummed content-pack manifests and compatibility checks;
- harden draft, review, validation, revision, and deprecation workflows;
- evaluate extracting `gewu-algorithm-templates` only after the schema and
  contribution cadence satisfy the documented split criteria;
- add knowledge relationships only after they improve real recommendations.

Stage 9 now has a versioned SHA-256 content-pack manifest and verification
command (`gewu-template pack build|verify`), explicit lifecycle transition
rules, and documented split criteria. The current repository remains the
content owner: it has not reached the unit count, independent contribution
cadence, or release ownership needed for a separate templates repository.
Knowledge relationships remain part of the AlgorithmUnit contract and are not
expanded without evidence that they improve Stage 8 recommendations.

## Stage 10: Core Web Client

Status: complete for the first-party Web slice as of 2026-08-05. Third-party
editor expansion remains a later stage.

- provide a Vite Web Practice Client at `localhost:5173`;
- expose the existing Rust Core through a localhost HTTP adapter carrying the
  existing JSON-RPC contract;
- support unit, mode, and `practice_id` selection plus all core practice event
  paths;
- show review recommendations, interrupted checkpoints, and recent attempts;
- keep scoring, state transitions, checkpoint recovery, attempts, and review
  persistence in Rust Core.

VS Code, Zed, and synchronization are intentionally deferred until the
first-party client has validated the shared protocol and interaction model.
- treat client-specific interaction polish as adapter work rather than a blocker
  for platform-independent core development.

## Stage 11: Structured Code Recall Layouts

Status: complete. The layout enum, validated template contract, Core replay and
checkpoint behavior, Protocol projection, Web interactions, generation
profile, and learning-design review rule are implemented. See
[the layout architecture](architecture/code-recall-layouts.md) and
[ADR 0018](decisions/0018-code-recall-layouts.md).

- define reviewed `full_recall`, `comment_guided`, `comment_to_code`, and
  `cloze` layouts under the existing `code_recall` mode;
- separate layout semantics from assistance and prompt-reveal policies;
- implement the Core-owned fixed-region/editable-slot state machine with
  deterministic replay, checkpoint, restart, stop, and attempt facts;
- expose layout and editable-slot state through the protocol;
- implement Web support for `cloze`, `comment_guided`, and `comment_to_code`;
- cover the shared edit, Unicode, interruption, and mode/variant contracts in
  Core and Web tests;
- defer VS Code and Zed layout adapters until the Core contract is stable.

Exit achieved: all three new layouts replay through Core, persist their
selected practice identity, and the Web client completes representative
fixtures without client-owned scoring.
