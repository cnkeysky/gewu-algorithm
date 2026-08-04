# Product Requirements

## 1. Purpose

This document defines the initial product requirements for `gewu-algorithm`. Requirement IDs are stable references for issues, tests, pull requests, and release notes.

## 2. Product Scope

The product provides structured algorithm practice based on versioned `AlgorithmUnit` content. It begins with `shadow_typing` and `flow_recall`, then may add `code_recall`, `reasoning_recall`, and `transfer_practice` after their interaction and scoring contracts are specified.

It is not initially a problem judge, a complete spaced-repetition platform, a social network, or an automatic replacement for editorial review.

## 3. Terms

| Term | Meaning |
| --- | --- |
| `AlgorithmUnit` | Versioned learning content describing a problem, implementation, reasoning, boundaries, practice activities, provenance, and validation state |
| Practice mode | A defined interaction and scoring strategy applied to an `AlgorithmUnit`; stable values are defined in the domain terminology |
| Shadow Typing | `shadow_typing`: exact reconstruction of one specified code variant with progressive visual guidance |
| Flow Recall | `flow_recall`: reconstruction of reviewed execution states or steps without exact prose matching |
| Reasoning Recall | `reasoning_recall`: reconstruction of mechanism, invariant, trade-offs, boundaries, and failure conditions |
| Transfer Practice | `transfer_practice`: application of a pattern to a new case while identifying differences and limits |
| Draft | Content that is not approved for an official pack |
| Reviewed | Content inspected for structure, correctness, provenance, and learning value |
| Validated | Reviewed content whose executable examples and declared checks pass |

## 4. Functional Requirements

### Content

- **FR-001:** The system shall load a local `AlgorithmUnit` that conforms to a versioned public schema.
- **FR-002:** An `AlgorithmUnit` shall support multiple named implementation variants and programming languages.
- **FR-003:** An `AlgorithmUnit` shall record its position, problem, prerequisites, current understanding, relationships, boundaries, provenance, and validation state.
- **FR-004:** The system shall reject structurally invalid content with actionable field-level errors.
- **FR-005:** The system shall preserve the schema version and content revision used for every practice attempt.
- **FR-006:** Official content shall distinguish `draft`, `reviewed`, `validated`, `deprecated`, and `revised` lifecycle states.

### Practice

- **FR-100:** A user shall be able to start Shadow Typing from a supported code variant.
- **FR-101:** Shadow Typing shall compare the user's input against the selected canonical text deterministically.
- **FR-102:** The practice engine shall report accepted input, errors, progress, cursor position, elapsed time, and completion state.
- **FR-103:** A user shall be able to delete accepted input and resume from the resulting valid state.
- **FR-104:** Paste, multi-character edits, Undo/Redo, formatting, and external document changes shall have defined behavior.
- **FR-105:** The UI shall clearly identify exact-match practice and shall not describe it as arbitrary solution validation.
- **FR-106:** The MVP shall provide `shadow_typing` and `flow_recall` modes with independent completion records.
- **FR-107:** Practice scoring shall record prompt usage separately from accuracy and speed.
- **FR-108:** A practice session shall remain usable without an LLM provider or network connection.

### History and Review

- **FR-200:** The system shall store practice attempts locally by default.
- **FR-201:** The user shall be able to inspect recent attempts and the content revision used.
- **FR-202:** The system shall support deletion of local practice history.
- **FR-203:** Future review scheduling shall consume attempt data through a stable domain interface rather than editor-specific storage.

### Editor Integration

- **FR-300:** The VS Code extension shall be a client of the core practice engine.
- **FR-301:** Editor-specific code shall not define scoring, content validation, or review rules.
- **FR-302:** The editor shall expose clear start, stop, restart, and exit-practice commands.
- **FR-303:** Practice UI shall preserve editor theme compatibility and keyboard accessibility.
- **FR-304:** Zed shall not be a release blocker until its extension API supports the required interaction surface.

### LLM Integration

- **FR-400:** LLM support shall be optional and provider-independent.
- **FR-401:** LLM tasks shall use typed task contracts rather than an unstructured public `chat` abstraction.
- **FR-402:** Generated content shall enter a draft state and shall never be published automatically.
- **FR-403:** Generated structured output shall be schema-validated before storage.
- **FR-404:** The user shall see what content will be sent to a remote provider before the first transmission for a workflow.
- **FR-405:** API credentials shall use editor or operating-system secret storage and shall never be written to logs or templates.

## 5. Non-Functional Requirements

- **NFR-001 Performance:** Character feedback for an ordinary practice unit should be perceived as immediate; blocking network or model calls are forbidden on the input path.
- **NFR-002 Determinism:** Identical content, configuration, and input events shall produce identical practice state and scoring.
- **NFR-003 Offline Operation:** Local content loading, Shadow Typing, Flow Recall, and history access shall work offline.
- **NFR-004 Privacy:** User code, practice data, and telemetry shall remain local unless the user explicitly enables an external action.
- **NFR-005 Security:** Remote text, generated content, and template files shall be treated as untrusted input.
- **NFR-006 Compatibility:** Public schemas and client protocols shall be versioned and have documented compatibility rules.
- **NFR-007 Maintainability:** Core domain crates shall not depend on editor APIs or concrete LLM providers.
- **NFR-008 Accessibility:** Required actions shall be keyboard operable, and status shall not be communicated by color alone.
- **NFR-009 Portability:** Persistent paths and protocol messages shall not assume one operating system.
- **NFR-010 Observability:** Logs shall use levels and structured context while redacting secrets and user content by default.

## 6. Privacy and Licensing Requirements

- **PRIV-001:** Personal practice data shall be excluded from Git by default.
- **PRIV-002:** Telemetry, if introduced, shall be opt-in and documented at the event-field level.
- **PRIV-003:** Users shall be able to delete locally stored history and cached generated drafts.
- **LIC-001:** Distributable content shall record source, author or generator, license, and review information.
- **LIC-002:** Content without redistribution permission shall not enter an official public pack.
- **LIC-003:** External problem URLs may be stored as references, but copyrighted statements and editorials shall not be copied by default.

## 7. Initial Acceptance Criteria

The first MVP is acceptable when:

1. a schema-valid fixture can be loaded by the Rust core;
2. an invalid fixture produces a useful validation error;
3. a VS Code user can complete an exact-match practice session;
4. deletion, paste, Undo/Redo, Tab, line endings, and formatting behavior are covered by automated or explicit integration tests;
5. the session result is stored locally with content and protocol versions;
6. the same practice logic can be executed through a CLI or core test without VS Code;
7. no network or LLM configuration is required;
8. logs and persisted data contain no credential values.

## 8. Open Questions

- Should whitespace normalization be a separate mode or remain strict in the MVP?
- Should Flow Recall use ordered steps, state transitions, or both?
- Which attempt data is necessary to evaluate delayed retention without collecting excessive personal data?
- What minimum evidence is required before an official template is marked `validated`?
- When should official content move to a separate `gewu-algorithm-templates` repository?
