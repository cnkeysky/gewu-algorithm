# ADR 0008: Treat Interrupted Practice as a Separate Checkpoint

- Status: accepted
- Date: 2026-08-04

## Context

Closing VS Code or losing a core process should preserve work without creating a completed or explicitly stopped learning record. Persisting arbitrary selected editor text would create an unclear privacy boundary.

## Decision

Persist one local checkpoint for an active session started from a versioned `AlgorithmUnit`. Store replayable typed event facts, the unit revision, mode, and selected implementation. Recovery is explicit through Resume or Discard. Clear the checkpoint on completion, explicit Stop, or discard. Do not checkpoint ad-hoc selected source in the MVP.

## Consequences

- Crashes preserve recoverable work without contaminating attempt history.
- A revision mismatch produces a controlled resume error.
- Multiple concurrent active checkpoints remain outside the MVP.
