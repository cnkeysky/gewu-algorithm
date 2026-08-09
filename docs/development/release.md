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
3. Run `npm run check:version -- --fix` so the README "internal vX.Y.Z level"
   line, VS Code package version, CHANGELOG section, and release record all
   match the release version; CI's Version sync job enforces the same check on
   every push so a stale version can never ship.
4. For every contract change, review the cascade checklist in
   [`coding-standards.md`](coding-standards.md) and attach the propagation
   matrix to the change review.
5. Run formatting, lint, unit, schema, protocol, persistence, and integration tests.
6. Run dependency vulnerability and license checks.
7. Build binaries for supported targets in clean environments.
8. Package and install the VS Code extension artifact.
9. Regenerate and ship the published-unit content pack: run
   `npm run units:pack` (writes `units/index.json` + `gewu-units-*.tar.gz`),
   commit the ledger, and attach the tarball to the release
   (`gh release upload <tag> <tarball>`). A fresh clone uses the committed
   ledger for batch dedup and `npm run units:fetch` to pull the content.
10. Verify offline local practice.
11. Verify credential redaction and local-data deletion.
12. Verify upgrade from the previous supported release.
13. Tag immutable source revisions and publish checksums (the ledger's
    `sha256` per unit is the content checksum).

## Versioning Policy

Before `1.0`, incompatible changes are allowed only with explicit migration notes and a narrow support window. After public contracts stabilize, use semantic versioning for product releases and explicit major versions for schemas and protocols.

Do not mark content `validated` merely because structural CI passes. Content validation must satisfy its declared code, review, provenance, and boundary checks.
