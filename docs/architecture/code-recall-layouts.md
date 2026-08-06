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
  blocks[]
    id
    cue
    editable_slots[]
      id
      expected_text
```

`comments` is therefore an interaction/layout concern, not an assistance mode.
Assistance policies such as `none`, `keywords`, and `skeleton` control what may
be revealed; they do not determine the scoring model.

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

## Rollout

Implement `cloze` first to validate fixed/editable regions, then
`comment_guided`, and finally `comment_to_code`. Web is the first client for
these layouts; native editor adapters follow after the Core and protocol
contracts have stable replay tests.
