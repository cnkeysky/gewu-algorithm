# VS Code Manual Verification Checklist

Run this checklist in a real Extension Development Host before Stage 2 or the
VS Code portion of Stage 3 is marked complete. Record the VS Code version,
operating system, keyboard layout, and result in the issue or release notes.

## Startup

- Open the repository root, press F5 with `Run GEWU Local MVP`, and confirm the
  extension host activates without errors or a restored unrelated untitled file.
- Run `GEWU: Start Shadow Typing`, select BFS, and confirm one dedicated
  untitled practice editor opens.

## Shadow Typing

- Confirm ghost text advances after accepted input without flashing the whole
  accepted prefix.
- Type one character, paste an exact multi-character prefix, and paste a value
  containing a mismatch. A paste is atomic: any mismatch rejects the whole
  paste and restores the accepted prefix.
- Delete inside an earlier accepted line. The session must rewind to the
  deletion start and discard the later suffix because accepted text is always
  one canonical prefix.
- At leading indentation guidance such as `8sp`, use ordinary Tab input. With a
  four-space editor Tab width, the guidance must advance from `8sp` to `4sp`,
  then reveal the line body only after the second Tab. A `12sp` line requires
  three such Tabs. GEWU must not override the user's configured indentation width.
- Attempt multi-cursor input, Undo, Redo, formatting, snippet insertion, and
  completion insertion. Unsupported mutations must be rejected and restored.
- Type an opening bracket or quote with auto-closing enabled. The generated pair
  must be normalized to the expected opening character without changing global
  editor settings.
- Complete the final newline. `GEWU: Complete` must appear after one final Enter
  and offer `Close` and `Restart`. Restart must clear the same controlled editor
  and begin a fresh active session.
- Run `GEWU: Stop Practice`. The modal must ask `Stop practice?` with `Confirm`
  and `Cancel`. Confirm must close the practice editor without a save prompt.

## Interruption And Resume

- Delete the existing practice attempts, start Shadow Typing, enter a short
  correct prefix, then
  close the Extension Development Host without Stop or completion.
- Start F5 again and run `GEWU: Show Recent Attempts`. It must report no attempts.
- Run `GEWU: Resume Interrupted Practice`. The accepted prefix and cursor at its
  end must be restored. Before opening it, the confirmation must identify the
  unit, mode, revision, progress, and local saved time. Continue typing from the
  restored position.
- To exercise serialized rapid input, type a full canonical line continuously
  without waiting for ghost text updates. Characters must remain ordered and no
  accepted input may disappear. Pasting is a separate atomic-paste case.
- Run `GEWU: Discard Interrupted Practice`, restart the host, and verify Resume
  reports that no interrupted session exists.

## Flow Recall

- Run `GEWU: Start Flow Recall` and select BFS. Confirm a dedicated panel opens
  with the unit title, problem context, progress, completed flow, hidden reviewed
  prompt, answer field, and explicit actions.
- Reconstruct each step in natural language. Stable IDs may be used only as a
  test fallback; they must not be displayed as ordinary learning content.
- Choose Reveal. Confirm only the current reviewed prompt appears and progress
  does not advance. The button must become Hide; choose it and confirm the prompt
  is hidden without increasing prompt usage again. Submit one wrong answer and
  verify the panel retains the current step. History must report one prompt and
  one rejected answer.
- Submit an accepted answer. Confirm the reviewed step moves into Completed flow,
  the answer field clears, and the next step remains hidden.
- Close the panel while active, run Resume, confirm the Flow checkpoint identity,
  and verify the panel restores completed steps and current progress.
- Start another practice while a Flow checkpoint exists. Confirm the extension
  requires Resume, Discard, or Cancel and never silently overwrites it.
- Complete once and stop once so both terminal reasons can be inspected in
  history.

## Attempt History

- Run `GEWU: Show Recent Attempts`. Confirm completed and explicitly stopped
  sessions appear with mode, terminal reason, unit ID, revision, and timestamp.
- Confirm an interrupted active checkpoint does not appear in attempt history.
- Run `GEWU: Delete Practice Attempts`, select one or more attempts, confirm
  the Quick Pick selection once, and verify only those attempts are gone. There
  must be no redundant second confirmation. Select all for a full reset.

`stopped` is a terminal attempt summary, not resumable editor state. Explicit
Stop records metrics and clears the active checkpoint. Only an interrupted
active checkpoint can be resumed.

## Editor Boundaries

- Open two sessions in sequence. The first practice document must close without
  a save prompt and must not leave duplicate listeners or decorations.
- Confirm the repository source document remains byte-for-byte unchanged during
  every practice mutation.
- Test at least one CJK input method. Composition must not jump the cursor,
  duplicate text, or corrupt the accepted prefix.
- Verify final-newline completion with editor auto-indentation enabled. Generated
  indentation after the final newline must be removed before completion.

Automated tests cover LF/CRLF normalization, UTF-16-to-Unicode-scalar offset
translation, non-ASCII scalar deletion, emoji boundaries, and combining
sequences. These are implementation evidence, but they do not count as real
host verification. A versioned manual fixture with pinned line endings and
reviewed Unicode target text is required before the corresponding host items can
be marked passed.

A failed real-host item blocks the relevant stage exit decision.
