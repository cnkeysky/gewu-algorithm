# Coding Standards

## Objectives

Code should make domain behavior explicit, preserve compatibility, and remain testable without an editor or network connection. Consistency is enforced by tools where possible and by review where judgment is required.

## General Rules

- Keep changes scoped to one requirement or architectural decision.
- Prefer domain names over technical placeholders such as `Manager`, `Helper`, or `Utils`.
- Make invalid states difficult to represent with enums, newtypes, and validated constructors.
- Keep functions small enough to expose one responsibility, but do not create abstractions without demonstrated reuse or complexity reduction.
- Represent structured data with typed serializers and parsers, never ad hoc string concatenation.
- Keep time, filesystem, network, randomness, and provider calls behind injectable boundaries.
- Use UTC timestamps for persistence and protocols; convert for display at the client boundary.
- Do not log credentials, source code, prompts, full template bodies, or personal practice data by default.
- Comments explain non-obvious constraints or reasons, not line-by-line behavior.

## Dependency and Ownership Rules

- Domain and practice crates must not import editor, transport, storage-engine, or provider SDK types.
- Core application services compose domain ports; clients adapt external APIs.
- Protocol DTOs are converted at the boundary and do not leak into domain state.
- Persistence formats are versioned and accessed through repositories or stores owned by the core.
- Editor clients do not implement scoring, schema validation, or review scheduling.
- LLM adapters do not mutate published content directly.

Any exception requires an ADR.

## Repository and Package Naming

- Repository directories use concise responsibility names such as `crates/domain`, `crates/practice`, `apps/cli`, and `editors/vscode`.
- Cargo packages retain ecosystem-facing names such as `gewu-domain`, `gewu-practice`, and `gewu-cli`.
- The CLI package may expose the shorter user-facing binary name `gewu`.
- TypeScript packages and editor extension IDs retain a scoped or branded name to avoid registry collisions.
- Stable domain IDs use dotted notation such as `graph.bfs`; filesystem hierarchy uses directories such as `graph/bfs`.
- Do not encode the same namespace repeatedly in both every directory segment and its parent.
- Persisted mode values must use the canonical `snake_case` identifiers in [domain terminology](../architecture/terminology.md); display labels must not be used as protocol or storage keys.

## Rust

### Safety and Lints

- New crates should use `#![forbid(unsafe_code)]` unless an accepted ADR documents the need and review plan.
- CI treats compiler and selected Clippy warnings as errors.
- Formatting is owned by repository `rustfmt` configuration.
- Public contracts and non-obvious invariants require rustdoc.

### Errors

- Library crates expose typed errors, commonly using `thiserror` or equivalent explicit enums.
- `anyhow`-style context is appropriate at application boundaries, not as a public domain contract.
- Expected input, content, provider, or persistence failures must not panic.
- Avoid `unwrap`, `expect`, `panic!`, `todo!`, and `unreachable!` in production paths. Narrow exceptions require an adjacent invariant explanation and a test.
- Preserve error sources and add context at boundaries without including secrets or private content.

### Types and State

- Use newtypes for stable IDs, revisions, protocol versions, and durations when primitive confusion is plausible.
- Use enums for lifecycle and session transitions.
- Constructors validate invariants before a value enters domain state.
- Published immutable records should not expose unrestricted mutation.
- Prefer borrowed data only when it improves a measured path; start with clear ownership.

### Async and Concurrency

- Keep character-level practice transitions synchronous and deterministic.
- Network, process, and provider calls require cancellation and timeouts.
- Do not hold locks across `.await`.
- Background tasks must have explicit ownership and shutdown behavior.

## TypeScript and VS Code

- Enable `strict` TypeScript settings.
- Avoid `any`; use `unknown` at untrusted boundaries and narrow it through validation.
- Use discriminated unions for protocol results and editor session states.
- Validate all messages received from the core before using them.
- Dispose commands, decorations, watchers, processes, and event subscriptions through extension lifecycle ownership.
- Keep VS Code API objects inside the adapter layer.
- Never interpolate untrusted content into executable commands, HTML, or filesystem paths.
- Webviews require a restrictive Content Security Policy, nonce-based scripts, theme tokens, keyboard navigation, and accessible labels.

## Protocol and Schema Changes

- Public messages and schemas require examples and negative tests.
- Additive optional fields are preferred over changed meanings.
- Unknown fields should be tolerated where the compatibility policy permits; unknown enum values must produce a controlled compatibility error.
- Removing, renaming, or changing semantics requires a version change, migration plan, and ADR.
- Protocol stdout contains protocol frames only.

## Tests with Code Changes

- A bug fix includes a failing regression test before or with the fix.
- New domain behavior includes unit tests for success, boundary, and invalid transitions.
- Parsers include invalid and unsupported-version cases.
- Persistent formats include round-trip and migration tests.
- Editor features include integration coverage for lifecycle and disposal.
- Test names describe observable behavior rather than implementation functions.

## Dependencies

- Prefer the standard library and existing workspace dependencies.
- A new dependency needs a clear owner, maintenance assessment, compatible license, and reason it is better than a small local implementation.
- Pin direct toolchain and package-manager versions where reproducibility requires it.
- Commit application lockfiles.
- Run vulnerability and license checks in release CI once dependency manifests exist.

## Review Checklist

- Does the change satisfy a documented requirement?
- Is the behavior in the correct ownership layer?
- Are invalid states and failure paths explicit?
- Are private data and credentials protected?
- Are compatibility and migration impacts documented?
- Do tests cover behavior rather than only implementation details?
- Has unnecessary complexity or a speculative abstraction been introduced?
- Do documentation and examples match the implemented contract?
