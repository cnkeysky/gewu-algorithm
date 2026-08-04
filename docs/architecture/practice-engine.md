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

## Flow Recall (`flow_recall`)

The MVP Flow Recall mode uses reviewed ordered concepts with optional aliases. It checks whether required states or steps are reconstructed in an acceptable order. It must not require exact prose matching.

Semantic LLM grading is out of scope for deterministic completion. An LLM may later provide non-authoritative feedback alongside a deterministic result.

## Invariants

- Applying the same event sequence to the same initial state produces the same result.
- A completed or stopped session rejects further practice events.
- Attempt creation is idempotent for one terminal session.
- Session state never contains credentials or editor-specific handles.
- Errors do not silently advance progress.
