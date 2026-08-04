# ADR 0003: Use Versioned JSON-RPC over Stdio

- Status: accepted
- Date: 2026-08-04

## Context

The VS Code extension is written in TypeScript while the core is written in Rust. The integration requires a debuggable, language-neutral boundary that can also support a CLI harness.

## Decision

Use JSON-RPC over stdio between native editor clients and a version-matched core process. Begin every connection with a compatibility handshake.

## Consequences

- Messages are inspectable and testable across languages.
- Standard output must be reserved for protocol frames; diagnostics go to standard error or structured log sinks.
- DTOs require explicit versioning and size limits.
- Process startup, cancellation, crash recovery, and binary packaging require integration tests.
- High-frequency input may require batching only if measurement demonstrates a problem.
