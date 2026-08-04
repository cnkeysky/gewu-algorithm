# ADR 0005: Separate Directory Names from Published Package Names

- Status: accepted
- Date: 2026-08-04

## Context

All implementation components already live inside the `gewu-algorithm` repository. Repeating `gewu-` in every internal directory, such as `crates/gewu-domain` and `apps/gewu-cli`, adds visual noise without improving local disambiguation.

Published Cargo packages, npm packages, binaries, and extension identifiers exist outside the repository context and still need collision-resistant, recognizable names.

Algorithm content has the same distinction: a stable domain ID such as `graph.bfs` is not required to be the literal filesystem directory name.

## Decision

Use concise responsibility-based repository paths:

```text
crates/domain
crates/template
crates/practice
crates/protocol
crates/core
apps/cli
editors/vscode
```

Use branded names at ecosystem boundaries:

```text
Cargo package: gewu-domain
Cargo package: gewu-practice
Cargo package: gewu-cli
CLI binary: gewu
VS Code extension ID: cnkeysky.gewu-algorithm
```

Use filesystem hierarchy for content paths, such as `graph/bfs`, while retaining dotted stable IDs such as `graph.bfs` inside content manifests.

## Consequences

- Local paths remain concise and easy to scan.
- Published artifacts remain recognizable and less likely to collide.
- Package names cannot always be inferred directly from directory names, so manifests and architecture documentation must make the mapping explicit.
- Tooling must use manifest metadata rather than assuming the directory basename equals the package name.
