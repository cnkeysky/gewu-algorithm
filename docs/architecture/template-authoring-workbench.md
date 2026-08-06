# Template Authoring Workbench

## Purpose

The authoring workbench is a local, platform-independent tool for creating,
checking, reviewing, editing, and accepting GEWU algorithm templates. It is not
the VS Code practice surface. VS Code, Zed, and future clients consume accepted
template contracts through the core protocol.

## UI technology

The first implementation uses Vite, TypeScript, semantic HTML, and plain CSS,
served by a small local TypeScript HTTP service. Vite provides the development
server and production bundle without coupling the workbench to an editor
extension. The UI should be organized around explicit state and typed API
payloads rather than DOM scraping. React remains an optional later addition if
the review surface requires a component framework; it is not required by the
authoring contract.

## Main views

1. **New draft**: complete learner-facing problem statement, selected source material, provider/model
   selection, implementation languages and variant count, practice modes, and
   code-recall assistance.
2. **Draft workspace**: manifest, implementation sources, tests, and practice
   projections in separate tabs with schema-aware editing.
3. **Validation**: schema, source-path, code, and fixture results with exact
   paths and actionable messages.
4. **Review**: role-specific LLM reports, immutable artifact hash, findings,
   repair handoffs, and human accept/reject actions.
5. **History**: drafts and reports indexed by task version and artifact hash.

## Generation profile

`GenerationProfile` selects projections of one `AlgorithmUnit`:

- `practice_modes` selects shadow typing, flow recall, code recall, reasoning
  recall, or transfer practice;
- `code_recall_assistance` selects skeleton, comments, keywords, cloze, or no
  hints and is valid only when code recall is selected;
- `implementation_languages` and `implementation_variants` request source
  implementations, not copies of the algorithm unit.

The profile is part of the generation request and provenance. It must not be
used to bypass the unit schema or to publish a mode-specific replacement unit.
The generator must preserve the complete input problem as reviewed Markdown in
`problem.statement`, including supported math delimiters. The review gate checks
its semantic agreement with implementations, tests, and every practice
projection; a summary or solution-leaking rewrite is not acceptable.

Task and rubric selection are authoring-service decisions, not required user
inputs. The service resolves the single registered generic task for every
problem; problem-class prompt templates are intentionally not used, and any
per-class strictness lives in the versioned review rubric. The service may ask
a reviewer model to identify applicable rubric rules. The model may only select
from versioned rules already present in the registry; it cannot invent a rule
or promote an artifact. The final review report exposes the selected rules and
evidence for human inspection.

## Security and persistence

Provider keys are read from the process environment or an OS credential
store. The browser never receives a key, and the workbench never persists a
key in local storage, draft files, logs, or review reports. Provider/model
selection may be persisted without credentials.

Drafts are mutable until accepted. Reviews are append-only records tied to the
artifact hash. Acceptance is a human action after deterministic validation and
role-specific review; a model pass cannot promote a draft.

The local authoring service uses SQLite. Queryable lifecycle fields are normal
columns in `drafts` and `reviews`; mode selections, assistance lists, and other
evolving payloads are stored as validated JSON text columns. The service
migrates the earlier ignored JSON state file once and then uses transactional
SQLite writes. A repository boundary keeps a future PostgreSQL or hosted
backend migration independent of the UI and HTTP contract.

## API boundary

The workbench API should expose typed operations such as:

- `POST /api/drafts/generate`
- `POST /api/drafts/:id/validate`
- `POST /api/drafts/:id/reviews`
- `PATCH /api/drafts/:id`
- `POST /api/drafts/:id/accept`
- `GET /api/drafts` and `GET /api/drafts/:id`

The service calls the existing TypeScript generation/review pipeline and Rust
validators. It does not implement practice transitions, editor state, or
provider-specific prompt parsing.
