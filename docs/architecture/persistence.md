# Local Persistence

`crates/storage` owns the versioned JSON format and same-filesystem temporary-file replacement; `crates/core` decides when to write. The MVP assumes one core writer per data root. Editors never write persistent files directly. The CLI defaults to `$XDG_DATA_HOME/gewu-algorithm`, then `$HOME/.local/share/gewu-algorithm`; `GEWU_DATA_DIR` or `--data-root` provides a portable override.

| Record | Written when | Contains | Cleared when |
| --- | --- | --- | --- |
| Terminal attempt | completion or explicit Stop | unit/revision/schema, mode, aggregate metrics, duration, terminal reason | user deletes history |
| Checkpoint | active versioned-unit activity | unit/revision, mode, implementation, replayable typed events | completion, Stop, or discard |

An interrupted checkpoint is not an attempt. Resume is explicit, and the core verifies the content revision before replaying it. Ad-hoc selected source is intentionally not checkpointed in the MVP, avoiding silent long-term persistence of arbitrary editor contents. Invalid JSON yields a typed corruption error rather than a panic.

Cross-platform packaged-binary and concurrent-writer checks remain release work. A second core process must not share one data root until an explicit locking or conflict policy is implemented.
