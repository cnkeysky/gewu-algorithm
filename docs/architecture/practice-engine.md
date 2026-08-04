# Practice Engine

## Responsibility

The practice engine owns deterministic session transitions, scoring inputs, hint state, and completion rules. It does not render UI, call an LLM, fetch remote problems, or select editor commands.

## Common Mode Contract

Every practice mode defined in [domain terminology](terminology.md) specifies:

- required content inputs;
- initial state;
- accepted event types;
- transition function;
- hint policy;
- completion rule;
- attempt facts to record;
- mode-specific validation errors.

The common engine exposes start, apply-event, inspect, stop, and complete operations.

## Shadow Typing (`shadow_typing`)

The MVP mode is exact-match reconstruction of a selected implementation variant.

Canonical text normalization occurs once when the session starts. The policy must explicitly define:

- UTF-8 handling;
- LF and CRLF behavior;
- tabs and spaces;
- trailing newline;
- Unicode normalization;
- whether format-on-save is disabled or treated as an external edit.

The MVP should prefer strict canonical matching. Any later whitespace-tolerant behavior must be a separately named configuration or mode so results remain interpretable.

Stage 1 implements one normalization policy:

| Concern | Behavior |
| --- | --- |
| Input encoding | The core accepts Rust strings, which are valid UTF-8. Byte decoding belongs to the caller. |
| Line endings | CRLF and standalone CR are converted to LF. |
| Tabs and spaces | Preserved exactly; tabs and spaces are not interchangeable. |
| Trailing newline | Trailing line endings are removed, then exactly one LF is appended when `trailing_newline` is true. |
| Unicode normalization | No NFC or NFD conversion is performed; Unicode scalar values must match exactly. |

Text coordinates are half-open offsets measured in Unicode scalar values, never UTF-8 bytes. Grapheme-cluster-aware display remains a client responsibility and must not change the core comparison contract.

## Events

Editor mutations are translated into domain events rather than passing raw editor objects into the core. Candidate events include:

```text
InsertText
DeleteBackward
DeleteRange
ReplaceRange
RevealHint
Restart
Stop
ExternalMutation
```

Paste and multi-character edits are `InsertText` or `ReplaceRange`, not special correctness shortcuts. Multi-cursor input should be rejected in the MVP unless a reliable deterministic mapping is implemented.

The Stage 1 state keeps only a canonical accepted prefix:

- `InsertText` appends at the prefix cursor. A single character and a multi-character paste use the same atomic comparison; the whole input is accepted or rejected.
- `DeleteBackward` and `DeleteRange` are accepted only when the resulting text is still a canonical prefix. A range that would leave a gap returns a typed error.
- `ReplaceRange` is one atomic transaction. Replacement text must produce a canonical prefix; mismatching replacement input is rejected without partially changing state.
- `Restart` clears the accepted prefix but retains accumulated facts for the same session.
- `Stop` creates a terminal stopped attempt. Exact completion creates a terminal completed attempt automatically.
- `ExternalMutation` and `MultiCursorEdit` return explicit unsupported-event errors in the MVP. Format-on-save is therefore an external mutation and must be disabled or rolled back by a later editor adapter.

Invalid ranges, regressing elapsed time, and events after completion or stop return typed errors and leave state unchanged. Rejected mismatching input records rejection facts but does not advance progress.

## Attempt Facts

Record facts rather than one opaque score:

- target character count;
- accepted and rejected input counts;
- correction count;
- hint count and revealed regions;
- active and wall-clock durations;
- completion or stop reason;
- normalization policy;
- unit, variant, schema, and engine versions.

Composite scores may be computed later from these facts and must declare their scoring version.

Stage 1 defines the count units as follows:

- accepted and rejected input counts are Unicode scalar values in inserted or replacement text;
- one accepted deletion or replacement increments the correction count once;
- every explicit hint event increments the hint count and records its target range, including repeated reveals;
- a restart increments the restart count without discarding earlier facts;
- target length and cursor position are Unicode scalar counts;
- active and wall-clock durations are cumulative elapsed values supplied by the caller and must be monotonic, with active time not exceeding wall-clock time.

The deterministic core never reads a clock. Timed events carry caller-observed cumulative durations, so the same configuration and timed event sequence reproduces the same state and attempt. Attempt access is idempotent: a terminal session owns one immutable record and repeated reads return that record.

## Flow Recall (`flow_recall`)

The MVP Flow Recall mode uses reviewed ordered concepts with optional aliases. It checks whether required states or steps are reconstructed in an acceptable order. It must not require exact prose matching.

Semantic LLM grading is out of scope for deterministic completion. An LLM may later provide non-authoritative feedback alongside a deterministic result.

## Invariants

- Applying the same event sequence to the same initial state produces the same result.
- A completed or stopped session rejects further practice events.
- Attempt creation is idempotent for one terminal session.
- Session state never contains credentials or editor-specific handles.
- Errors do not silently advance progress.
