# Code Recall Layouts

Code Recall remains one platform-independent practice mode. Its presentation
and interaction shape is selected by a reviewed `practice_id` layout; layouts
must not be promoted to separate top-level modes.

## Layouts

| Layout | Fixed content | Learner input | Primary training target |
| --- | --- | --- | --- |
| `full_recall` | Prompt and optional hints | Complete canonical implementation | Reconstruct the implementation |
| `comment_guided` | Reviewed comments interleaved with code slots | Code for each slot | Map algorithm steps to implementation |
| `comment_to_code` | Reviewed comments or operation descriptions | Complete implementation | Generate code from intent |
| `cloze` | Reviewed surrounding code | Declared code slots | Recover key decisions and expressions |

The schema uses reviewed blocks and slots rather than a mandatory one-comment-
one-line relationship. One algorithm step may correspond to several lines, and
one line may contain several independent decisions.

```text
CodeRecallDefinition
  layout
  prompt
  scaffold[]
  source_template
  slots[]
    id
    cue
    expected
```

Layout determines the scoring model. In schema version 1, the two comment-based
layouts require `comments` assistance so their reviewed cues and scaffold use
the existing assistance field without a parallel content channel. Those
comments are intrinsic fixed content and are not counted as revealed hints.
Other assistance policies continue to control optional reveal behavior.

## Shared Engine

All layouts use a structured code-recall state machine. The Core owns fixed
regions, editable slots, Unicode offsets, deletion/replacement validation,
progress, hints, checkpoints, restart, stop, and attempt facts. Clients only
render the projection and submit edits.

The first implementation keeps each slot deterministic and canonical. Semantic
equivalence between different implementations is not inferred during a
session; it must be represented as reviewed alternatives in a later contract.

## Completion and Scoring

Code Recall records accepted and rejected edits per slot. Fixed comments and
surrounding code are not learner input in `comment_guided` or `cloze`. A session
completes only when every required editable slot is accepted. Reveals remain
separate assistance facts and do not make a slot correct.

## Client Boundary

Web is the first client for these layouts. `comment_guided` and `cloze` render
the fixed template outside the editable answer control and submit only slot
text. `comment_to_code` renders its complete reviewed comment scaffold beside
the full-code editor. Native editor adapters follow the same Core contract
after the protocol has stable replay tests.
