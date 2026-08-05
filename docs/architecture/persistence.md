# Local Persistence

`crates/storage` owns the versioned JSON format and same-filesystem temporary-file replacement; `crates/core` decides when to write. The MVP assumes one core writer per data root. Editors never write persistent files directly. The CLI defaults to `$XDG_DATA_HOME/gewu-algorithm`, then `$HOME/.local/share/gewu-algorithm`; `GEWU_DATA_DIR` or `--data-root` provides a portable override.

The Template Authoring Workbench is a separate bounded context. Its SQLite
database at `tools/template-authoring/drafts/.workbench/authoring.sqlite`
stores draft and review workflow metadata; it does not replace or share the
Rust Core attempt/checkpoint store. Practice attempts, checkpoints, and editor
history therefore continue to use the versioned Rust storage adapter. Keeping
these stores separate prevents authoring review lifecycle from being confused
with learner practice facts and leaves each context free to evolve its format.

| Record | Written when | Contains | Cleared when |
| --- | --- | --- | --- |
| Terminal attempt | completion or explicit Stop | unit/revision/schema, mode, aggregate metrics, duration, terminal reason | user deletes history |
| Checkpoint | active versioned-unit activity | stable ID, unit/title/revision, mode, display-safe progress, implementation, replayable typed events | completion, Stop, or discard of that checkpoint |
| Review state | terminal attempt | unit/revision/mode, stability, difficulty, last review, next due time, scheduler/model versions | explicit data reset |

Interrupted checkpoints are stored as a selectable collection in `checkpoints-v2.json`; the prior `checkpoint-v1.json` is ignored without migration. A checkpoint is not an attempt. Resume is explicit by stable checkpoint ID, and the core verifies the content revision before replaying it. Ad-hoc selected source is intentionally not checkpointed in the MVP, avoiding silent long-term persistence of arbitrary editor contents. Invalid JSON yields a typed corruption error rather than a panic.

Review scheduling state is stored separately in `review-state-v1.json`. It is a
small projection, not a replacement for immutable attempts: deleting attempt
history does not silently rewrite scheduler facts, and a future reset operation
must clear both stores explicitly. `next_due_at_ms` is computed locally using
the deterministic scheduler; an optional model can contribute only a recorded
model version and bounded scoring adjustment.

Cross-platform packaged-binary and concurrent-writer checks remain release work. A second core process must not share one data root until an explicit locking or conflict policy is implemented.
