# ADR 0010: Persist Selectable Interrupted Practice Checkpoints

- Status: accepted
- Date: 2026-08-05
- Supersedes: [ADR 0008](0008-interrupted-practice-checkpoint.md)

## Context

Stage 3 supports two practice modes, and starting a new session must not silently replace unrelated interrupted work. The previous singleton checkpoint constraint made interruption recovery depend on start order and prevented learners from choosing which work to continue.

## Decision

Persist a collection of active, versioned-unit checkpoints in `checkpoints-v2.json`. Each checkpoint has a stable ID derived from its session ID and stores its unit title, revision, mode, selected implementation where applicable, and replayable typed events. The legacy `checkpoint-v1.json` is not migrated or read.

The core exposes checkpoint listing plus explicit resume and discard operations by checkpoint ID. A checkpoint remains a non-terminal recovery record: it never creates or changes attempt history. Completion, explicit Stop, and discard remove only the matching checkpoint. VS Code presents checkpoint identity, unit, revision, mode, progress, and save time before Resume or Discard. Start commands show only checkpoints matching their requested practice mode, while the dedicated Discard command supports selecting multiple checkpoints. VS Code permits only one active practice UI at once.

The VS Code client does not offer a second new session for the same unit,
revision, and mode while one is already interrupted. The learner resumes or
discards that checkpoint first; distinct units and modes may coexist.

This changes the pre-release protocol v1 request shapes in lockstep with the only
current client. No stable protocol release consumes the prior singleton methods;
a future published protocol change must instead increment its major version.

## Consequences

- Interrupted Shadow Typing and Flow Recall sessions can coexist across a core restart.
- Starting a new session may retain all existing checkpoints; users choose a specific checkpoint to resume or discard.
- Revision mismatch remains a controlled resume error for the selected checkpoint.
- Checkpoint-v1 data is intentionally ignored, so Stage 3 does not perform an implicit migration of replayable user activity.
