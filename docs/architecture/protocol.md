# Local Protocol

Stage 3 clients communicate with the native Rust core using JSON-RPC 2.0 frames over UTF-8 stdin/stdout. Each frame occupies one line (NDJSON). Standard output contains only frames; diagnostics belong on standard error.

Every connection calls `gewu/handshake` with the client name/version and its inclusive supported protocol range before other methods. The core selects protocol v1 only when it falls inside that range. JSON-RPC errors use numeric codes and carry a stable machine-readable `data.kind`. Transport DTOs live in `crates/protocol`; internal domain and practice types never cross this boundary.

| Method group | Purpose |
| --- | --- |
| `handshake`, `listUnits`, `loadUnit` | Compatibility and schema-validated local content discovery. |
| `startSession`, `applyEvent`, `stopSession` | Rust-owned `shadow_typing` and `flow_recall` transitions. |
| `recentAttempts`, `deleteHistory` | Local terminal-attempt inspection and deletion. |
| `saveCheckpoint`, `resumeCheckpoint`, `discardCheckpoint` | Explicit recovery of one non-terminal versioned-unit session. |

The shared [v1 handshake fixture](../../fixtures/protocol/v1-handshake.ndjson) is checked by both Rust and TypeScript tests. Changing it changes a public boundary and requires compatibility review.
