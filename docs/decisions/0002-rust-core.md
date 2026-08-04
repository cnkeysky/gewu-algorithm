# ADR 0002: Use Rust for the Editor-Independent Core

- Status: accepted
- Date: 2026-08-04

## Context

Practice behavior, template validation, history, and future review logic must be shared by VS Code, CLI, Zed, and possible future clients. Implementing this behavior separately in each editor would create inconsistent scoring and migration behavior.

## Decision

Implement the editor-independent core in Rust. Use TypeScript for the VS Code client and the implementation language required by other host platforms.

## Consequences

- Domain and practice logic can be reused across clients.
- Native binary packaging and protocol compatibility become release concerns.
- Browser-only clients will require WebAssembly or a service later.
- Rust crates must avoid editor and concrete provider dependencies.
