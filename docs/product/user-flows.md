# User Flows

## Start Local Shadow Typing

```text
Open template view
  -> choose AlgorithmUnit
  -> choose language and variant
  -> choose Shadow Typing
  -> core validates content
  -> editor opens dedicated practice session
  -> user types and receives deterministic feedback
  -> session completes or is explicitly stopped
  -> local attempt is saved
```

Failure states must identify whether the problem is invalid content, an unavailable core process, unsupported editor behavior, or persistence failure.

## Resume Interrupted Practice

```text
VS Code closes or core process exits while session remains active
  -> core has saved a versioned-unit checkpoint after each accepted/rejected event
  -> no terminal attempt is created
  -> user chooses Resume Interrupted Practice or Discard Interrupted Practice
  -> client shows unit, mode, revision, progress, and local saved time
  -> user confirms the identified checkpoint
  -> core verifies the content revision before replaying typed events
```

Explicit Stop creates a stopped attempt and clears the checkpoint. Completion creates a completed attempt and clears it. Arbitrary selected editor text is not saved as an MVP checkpoint.

## Practice Flow Recall

```text
Choose AlgorithmUnit
  -> select Flow Recall
  -> open a structured panel with problem context and progress
  -> reconstruct ordered states or steps in the learner's own words
  -> reveal hints only on request
  -> retain completed reviewed steps while later steps remain hidden
  -> save result and hint usage
```

Flow Recall scoring must not imply that one wording is the only valid explanation. The initial MVP may use ordered concepts and manually reviewed aliases.

## Generate a Draft with an LLM

```text
Provide local code or explicitly selected source text
  -> review data that will leave the machine
  -> select provider and task
  -> receive typed draft
  -> validate schema
  -> compile or test code when possible
  -> inspect provenance, relationships, boundaries, and counterexamples
  -> save locally as draft
  -> LLM acceptance gate decides publication (LLM approved); human approval
     is the superior upgrade tier, not a prerequisite
```

This flow is post-MVP.

## Revise an Existing Unit

```text
Open reviewed unit
  -> create new revision
  -> state what changed and why
  -> run schema and code validation
  -> review compatibility and practice impact
  -> mark old revision as revised or deprecated
  -> publish the new revision
```

Historical attempts continue to reference the revision used at practice time.
