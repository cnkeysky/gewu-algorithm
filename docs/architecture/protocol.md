# Local Protocol

Stage 3 clients communicate with the native Rust core using JSON-RPC 2.0 frames over UTF-8 stdin/stdout. Each frame occupies one line (NDJSON). Standard output contains only frames; diagnostics belong on standard error.

Every connection calls `gewu/handshake` with the client name/version and its inclusive supported protocol range before other methods. The core selects protocol v1 only when it falls inside that range. JSON-RPC errors use numeric codes and carry a stable machine-readable `data.kind`. Transport DTOs live in `crates/protocol`; internal domain and practice types never cross this boundary.

| Method group | Purpose |
| --- | --- |
| `handshake`, `listUnits`, `loadUnit` | Compatibility and schema-validated local content discovery. |
| `startSession`, `applyEvent`, `stopSession`, `restartSession` | Rust-owned `shadow_typing`, `flow_recall`, `code_recall`, `reasoning_recall`, and `transfer_practice` transitions. Restart creates a fresh session rather than mutating a terminal attempt. |
| `recentAttempts`, `deleteAttempts`, `deleteHistory` | Local terminal-attempt inspection and selective or full deletion. |
| `saveCheckpoint`, `listCheckpoints`, `resumeCheckpoint`, `discardCheckpoint` | Explicit recovery of selected non-terminal versioned-unit sessions. `listCheckpoints` returns stable IDs plus display-safe identity, mode, progress, and save metadata; resume and discard require `checkpoint_id`. |

The shared [v1 handshake fixture](../../fixtures/protocol/v1-handshake.ndjson) is checked by both Rust and TypeScript tests. Changing it changes a public boundary and requires compatibility review.

Code Recall extends protocol v1 additively with the `code_recall` mode,
`reveal_scaffold` event, and optional guidance fields. Session views expose only
explicitly revealed scaffold content; unrevealed items are represented by a
count and remain hidden. `startSession.practice_id` selects one reviewed Code
Recall definition, and checkpoints persist that selection. Prompt and scaffold
reveal counts remain separate in session and attempt facts.

Reasoning Recall and Transfer Practice use the same additive protocol boundary.
`startSession.practice_id` selects one reviewed definition for either mode;
checkpoint replay preserves that selection. Their submit/reveal/restart events
remain deterministic, while open-ended explanation quality is explicitly outside
completion ownership.
