# Release Process

No stable release exists. This document defines the process to establish before the first distributable MVP.

## Versioned Components

Track separately:

- product release version;
- core binary version;
- protocol version and supported range;
- `AlgorithmUnit` schema version;
- content-pack version;
- practice scoring version;
- prompt/task version for generated drafts.

These versions should not all be forced to change together.

## Compatibility

The VS Code extension packages or resolves a compatible core binary. On startup, client and core perform a handshake and refuse unsupported combinations with an actionable message.

Published content packs declare supported schema versions. Attempts preserve the exact content revision and scoring version used.

## Release Candidate Checklist

1. Confirm requirements and non-goals for the release.
2. Update changelog and compatibility documentation.
3. Run formatting, lint, unit, schema, protocol, persistence, and integration tests.
4. Run dependency vulnerability and license checks.
5. Build binaries for supported targets in clean environments.
6. Package and install the VS Code extension artifact.
7. Verify offline local practice.
8. Verify credential redaction and local-data deletion.
9. Verify upgrade from the previous supported release.
10. Tag immutable source revisions and publish checksums.

## Versioning Policy

Before `1.0`, incompatible changes are allowed only with explicit migration notes and a narrow support window. After public contracts stabilize, use semantic versioning for product releases and explicit major versions for schemas and protocols.

Do not mark content `validated` merely because structural CI passes. Content validation must satisfy its declared code, review, provenance, and boundary checks.
