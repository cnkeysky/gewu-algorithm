# ADR 0012: Expose Code Recall Through the Core Boundary

- Status: accepted
- Date: 2026-08-05

## Context

The deterministic Code Recall state machine was initially usable only as a
practice-crate API. Core services and the local protocol still exposed only
Shadow Typing and Flow Recall, which would make a future client reimplement
content selection, reveal handling, or attempt facts.

Code Recall content can contain multiple definitions. The core needs a stable
selector that does not pretend an implementation key is the identity of a
practice definition.

## Decision

Expose `code_recall` through the existing core session lifecycle and protocol
v1 additively:

- `PracticeModeDto::CodeRecall` identifies the mode;
- `RevealScaffold` is a typed event;
- session and attempt summaries preserve prompt and scaffold reveal counts
  separately;
- session views return only explicitly revealed scaffold items, plus the total
  scaffold count and their stable indices;
- local checkpoints replay Code Recall events through the same core path;
- `practice_id` selects a reviewed `code_recall` definition; when omitted, the
  first definition remains the deterministic compatibility default;
- checkpoint persistence records `practice_id` so recovery resumes the same
  definition rather than reselecting by implementation.

## Consequences

- CLI/stdin clients can use Code Recall without an editor or network.
- Existing Shadow Typing and Flow Recall JSON remains compatible; new fields are
  additive and persisted scaffold counts default to zero for old attempts.
- Unrevealed scaffold content does not cross the core session-view boundary.
- VS Code does not gain Code Recall UI in this change; it remains a later adapter
  task.
