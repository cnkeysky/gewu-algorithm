# Contributing

`gewu-algorithm` is currently pre-alpha. Contributions should reduce uncertainty in the product model or move the defined MVP forward.

## Before Starting

1. Read the [requirements](docs/product/requirements.md) and [MVP scope](docs/product/mvp.md).
2. Read the [architecture overview](docs/architecture/overview.md).
3. Check existing [architecture decisions](docs/decisions/README.md).
4. Keep changes focused on one behavior or decision.

## Change Requirements

Every change must:

- describe the user or system problem it solves;
- avoid unrelated refactoring;
- include tests proportional to behavioral risk;
- update documentation when behavior or a public contract changes;
- preserve backward compatibility or explicitly document a migration;
- avoid committing secrets, personal practice data, or unreviewed third-party content.

Changes to schemas, protocol messages, scoring rules, persistent storage, privacy defaults, or repository boundaries require an Architecture Decision Record (ADR).

## Commit and Pull Request Guidance

- Use imperative, specific commit subjects.
- Keep generated output out of reviews unless it is a release artifact under test.
- Explain behavior changes and verification in the pull request.
- Link requirement IDs such as `FR-001` or `NFR-003` when applicable.
- State whether a change affects schemas, storage, protocol compatibility, privacy, or licensing.

## Required Checks

The exact commands will be added with the implementation. The intended minimum gate is:

```text
format
lint with warnings denied
unit tests
schema and fixture validation
protocol compatibility tests
extension integration tests where relevant
```

See [coding standards](docs/development/coding-standards.md) and [testing strategy](docs/development/testing.md).
