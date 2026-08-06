# Testing Strategy

## Principles

- Test deterministic behavior at the lowest responsible layer.
- Use real boundaries selectively; do not mock the domain model.
- Preserve failing examples as regression fixtures.
- Keep network-dependent tests out of the default local suite.
- A green structural check does not prove learning content is correct.

## Test Layers

### Domain Unit Tests

Cover:

- ID and revision validation;
- lifecycle transitions;
- relationship constraints;
- attempt immutability;
- scoring facts and derived calculations.

### Practice State-Machine Tests

Use table-driven and property-based tests for:

- insert, delete, replace, paste, and restart events;
- invalid and terminal transitions;
- Unicode and line-ending behavior;
- replay determinism;
- idempotent attempt creation;
- event sequences that previously caused editor divergence.

### Schema and Fixture Tests

Every supported schema version needs:

- at least one minimal valid fixture;
- representative complete fixtures;
- invalid fixtures for required fields, IDs, revisions, lifecycle, provenance, paths, and relationships;
- unsupported-version fixtures;
- source-file existence and path-containment checks.

### Protocol Contract Tests

Rust and TypeScript share serialized golden messages for:

- handshake;
- start session;
- apply event;
- inspect state;
- terminal result;
- typed errors;
- cancellation and process failure.

Golden updates require review because they change a public boundary.

### Persistence Tests

Cover round trips, atomic replacement, interrupted writes, corrupt input, migration, deletion, concurrent access policy, and path portability. Checkpoint coverage must include multiple stable IDs, selective resume/discard, terminal cleanup of only the matching checkpoint, restart persistence, and preservation of terminal attempt history.

### VS Code Integration Tests

Run inside an extension host and cover:

- activation and core handshake;
- start, restart, stop, and completion;
- decoration lifecycle;
- paste and multi-character edits;
- Undo/Redo policy;
- Tab and line endings;
- formatting and external document changes;
- process crash and recovery;
- extension deactivation and resource disposal.

Input-method behavior that cannot be automated reliably must have a short manual release checklist.

### LLM Adapter Tests

Use recorded or synthetic provider responses for parsing and error behavior. Live provider tests are opt-in, credential-gated, cost-limited, and never required for local practice tests.

Generated content quality needs human review fixtures and executable checks; snapshot similarity alone is insufficient.

## Quality Gates

### Contract Change Cascade Check

When a domain field, enum, schema, protocol message, session identity, or
persistence record changes, the test plan must include a propagation matrix.
At minimum, verify the value through creation, validation, core transition,
restart, checkpoint save/resume/discard, terminal attempt, review/recommendation
lookup, serialization, and each supported client surface. Include one test that
proves an old or incomplete representation is rejected when compatibility is
not supported. A test that passes only at the edited layer is insufficient.

Every pull request should eventually run:

```text
format check
lint
unit tests
schema and fixture tests
protocol contract tests
relevant integration tests
documentation link checks
```

Release candidates additionally run dependency audit, license checks, packaged-binary smoke tests, VSIX installation tests, and the manual compatibility checklist.

Coverage percentages are diagnostic, not a target by themselves. Critical state transitions, migrations, privacy boundaries, and protocol compatibility require direct tests regardless of aggregate coverage.
