# Review and Progression

`gewu-review` is the platform-independent policy boundary for Stage 8. It is a
pure projection over terminal attempt facts and never owns editor state,
content source, or LLM calls.

## Decision Inputs

The policy keeps only facts that can change a recommendation: unit ID and
revision, practice mode, terminal reason, accepted and rejected work, prompt
use, scaffold reveals, and elapsed time. It deliberately ignores source text,
answers, editor metadata, and presentation details.

## Policy

- Interrupted-only history produces no recommendation; only material completed
  at least once enters the review schedule (interrupted work stays in the
  Interrupted panel for resume or discard).
- Any rejected answer or assistance use schedules a high-priority review after
  one day.
- One clean completion schedules an independent delayed review after three
  days.
- Two or more clean completions allow progression after seven days.

The schedule is expressed as `due_after_days` for a fresh projection and as
`due_at_ms` when persisted scheduler state exists. Recommendations include the
policy version and source attempt IDs for auditability.

The persisted state uses an Ebbinghaus-inspired bounded stability estimate:
successful independent reconstruction increases stability, while rejection or
assistance dependence reduces it. This is a transparent prior, not a claim
that every learner follows one universal forgetting curve.

## User Overrides

`UserChoice::OverrideMode` and `UserChoice::Dismiss` create a separate
`ReviewDecision`. They do not rewrite, delete, or reinterpret historical
attempts, so later policy versions can reproduce the original recommendation.

## Verification

The policy has host-free Rust tests for assistance dependence, interrupted
histories, repeated independent completion, override isolation, and stable
unordered input. The CLI projection is available with `gewu review`.
