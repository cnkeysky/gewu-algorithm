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
- During an active Shadow Typing session, run `GEWU: Restart Practice` from the
  Command Palette. It must replace the current checkpoint rather than create a
  second checkpoint for the same task.
- Run `GEWU: Stop Practice`. The modal must ask `Stop practice?` with `Confirm`
  and `Cancel`. Confirm must close the practice editor without a save prompt.

## Interruption And Resume

- Delete the existing practice attempts, start Shadow Typing, enter a short
  correct prefix, then
  close the Extension Development Host without Stop or completion.
- Start F5 again and run `GEWU: Show Recent Attempts`. It must report no attempts.
- Run `GEWU: Resume Interrupted Practice`. The picker must identify each
  checkpoint by unit, mode, revision, progress, and local saved time. Select
  the Shadow checkpoint; its accepted prefix and cursor at the end must be
  restored. Continue typing from the restored position.
- To exercise serialized rapid input, type a full canonical line continuously
  without waiting for ghost text updates. Characters must remain ordered and no
  accepted input may disappear. Pasting is a separate atomic-paste case.
- Start Flow Recall, answer one step, then close the panel without Stop. Restart
  the host and verify Resume lists both checkpoints. Discard only the Flow
  checkpoint, restart again, and verify the Shadow checkpoint remains resumable
  while the discarded Flow checkpoint is absent. Attempt history must remain
  unchanged by either interruption or discard.

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
- Start Flow Recall while Shadow and Flow checkpoints exist. Confirm the Start
  picker shows only Flow Recall checkpoints plus `Start new Flow Recall`; Shadow
  checkpoints remain available through the dedicated Resume and Discard
  commands. Choosing Start new must retain the others and close the prior
  practice UI before opening the new one.
- In the subsequent unit picker, a unit with the same revision and requested
  mode as an existing checkpoint must not be offered for a duplicate session.
- Choose Stop in the Flow panel. It must stop immediately without opening a
  redundant confirmation dialog. The command-palette `GEWU: Stop Practice`
  remains the guarded path and must still ask for confirmation.
- Complete once and stop once so both terminal reasons can be inspected in
  history.

## Attempt History

- Run `GEWU: Show Recent Attempts`. Confirm completed and explicitly stopped
  sessions appear with mode, terminal reason, unit ID, revision, and timestamp.
- Confirm an interrupted active checkpoint does not appear in attempt history.
- Run `GEWU: Delete Practice Attempts`, select one or more attempts, confirm
  the Quick Pick selection once, and verify only those attempts are gone. There
  must be no redundant second confirmation. Select all for a full reset.
- Run `GEWU: Discard Interrupted Practice`, select multiple checkpoints in one
  picker, and verify they are all discarded without reopening the Command
  Palette or creating terminal attempts.

`stopped` is a terminal attempt summary, not resumable editor state. Explicit
Stop records metrics and clears only its active checkpoint. Only interrupted
active checkpoints can be resumed.

## Editor Boundaries

- Open two sessions in sequence. The first practice document must close without
  a save prompt and must not leave duplicate listeners or decorations.
- Switch from a practice editor to another tab and back. Guidance must reappear,
  and typing must remain controlled. Starting another practice while the old
  practice tab is hidden must close that tab rather than leave an independent
  untitled document.
- Confirm the repository source document remains byte-for-byte unchanged during
  every practice mutation.
- Test at least one CJK input method. Composition must not jump the cursor,
  duplicate text, or corrupt the accepted prefix.
- Verify final-newline completion with editor auto-indentation enabled. Generated
  indentation after the final newline must be removed before completion.

For real-host boundary verification, select `CRLF Boundary Fixture` in Shadow
Typing and complete it without an extra carriage-return mismatch or duplicate
newline. Its source is pinned to physical CRLF by `.gitattributes`, while the
practice target is canonical LF.

Then select `Unicode Boundary Fixture`. Type or paste the exact CJK and emoji
string, verify deletion around the emoji does not jump offsets, and verify the
decomposed `Cafe` plus combining acute sequence is not silently normalized.
Interrupt after accepting Unicode text, Resume, and confirm the cursor and
remaining guidance restore at the same scalar boundary.

Automated tests independently cover CRLF normalization, UTF-16-to-Unicode-scalar
translation, non-ASCII scalar deletion, emoji boundaries, and decomposed
combining sequences. Both automated and real-host evidence are required before
these boundary items are marked passed.

A failed real-host item blocks the relevant stage exit decision.
