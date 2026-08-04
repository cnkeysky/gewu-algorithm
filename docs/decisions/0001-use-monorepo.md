# ADR 0001: Begin with a Monorepo

- Status: accepted
- Date: 2026-08-04

## Context

Core crates, schemas, protocol messages, editor clients, and initial content will change together while the product model is being validated. Splitting them now would require coordinated versions and releases before the contracts are stable.

## Decision

Develop software, schemas, initial fixtures, editor clients, and built-in content in the `gewu-algorithm` repository. Keep clear internal ownership boundaries so components can be extracted later.

## Consequences

- Cross-component changes can be tested atomically.
- One pull request can update schema, loader, fixture, and client.
- Repository tooling must support Rust and TypeScript.
- Content may be split later when it has an independent lifecycle.
