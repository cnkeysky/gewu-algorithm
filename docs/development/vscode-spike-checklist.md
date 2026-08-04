# VS Code Spike Manual Checklist

Run this checklist in a real extension host before Stage 2 is marked complete. Record the VS Code version, operating system, keyboard layout, and result in the issue or release notes.

- Open the repository root in VS Code, press F5 with `Run GEWU Interaction Spike`, and confirm the extension host activates without errors.
- Run `GEWU: Start Shadow Typing (Spike)` and confirm the command opens a dedicated untitled practice editor.
- Confirm the current canonical line is visible as ghost text and advances after accepted input. A leading indentation first shows compact `4sp` and/or `Tab` guidance, then the line body; a newline boundary shows `Enter`.

- Start a session from a source document and confirm the source document remains byte-for-byte unchanged.
- Open two sessions in sequence and confirm the first untitled document is discarded without a save prompt, closed, and leaves no duplicate change notifications or decorations.
- Type one character, paste an exact multi-character prefix, paste a mismatch, delete backward, and replace a range.
- Confirm a mismatch restores the accepted prefix and leaves the source document untouched.
- Attempt a multi-cursor edit and confirm it is rejected and restored.
- Exercise Undo and Redo, format-on-save, snippets, completion insertion, and Tab. Practice documents must either reject and restore these mutations or have an explicitly tested policy.
- Type an opening bracket and quote with auto-closing enabled; confirm the generated pair is normalized to the opening character and typing can continue without losing the accepted prefix. Do not change global VS Code auto-closing settings.
- Verify LF and CRLF source files produce the same canonical practice target.
- Type non-ASCII characters, emoji, and combining sequences; confirm no cursor or decoration jumps occur.
- Test IME composition for at least one CJK input method. VS Code's composition lifecycle is not represented reliably by the current automated host-free tests.
- Complete a target with a final newline: `Enter` must remain required and `GEWU: Complete` must offer `Close` and `Restart`. Close discards the practice document without a save prompt; Restart clears it and begins a fresh controlled session.
- Repeat the final Enter with editor auto-indentation enabled; generated spaces or tabs must be removed before the completion notification.

The checklist is intentionally manual for host behavior that cannot be proved by pure TypeScript tests. A failed item blocks the Stage 2 exit decision.
