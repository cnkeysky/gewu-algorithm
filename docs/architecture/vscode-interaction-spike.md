# VS Code Interaction Spike

## Scope

This Stage 2 report records the editor-boundary decision for exact-match Shadow Typing. Stage 3 retains its native untitled-document adapter, but now launches the Rust core over stdio, persists through the core, and renders core-returned state. The pure TypeScript transaction policy remains regression evidence for host event translation; it is not the production scoring owner.

## Options Compared

| Option | Reliability and editor semantics | Accessibility and IME | Lifecycle and maintenance | Decision |
| --- | --- | --- | --- | --- |
| Native text editor + decorations | Reuses VS Code typing, paste, selection, clipboard, keyboard, undo stack, and theme/accessibility behavior. The adapter can reject unsupported transactions and restore the canonical prefix. | Uses the host editor's mature IME and screen-reader behavior. Composition events still need manual verification in the real extension host. | Small adapter surface. A dedicated `untitled:gewu-practice/<session>.txt` document isolates edits from the user's source file; one disposable owns the listener, document, and decorations. | **Selected** |
| Controlled virtual/custom document | Could enforce every mutation, but requires implementing a custom document/provider and reconciling VS Code's editing, undo, save, and close semantics. A content provider alone is read-only and cannot satisfy the MVP. | Would inherit less native editing behavior and increase IME/accessibility risk. | Larger API and lifecycle surface with no measured benefit for the MVP. | Rejected for Stage 2 |
| Webview editor | Full rendering control, but input, selection, clipboard, undo/redo, IME, focus, and text navigation become application code. | Requires CSP, nonce-based scripts, keyboard navigation, theme tokens, and explicit screen-reader semantics. IME behavior is the highest-risk area. | Separate message bridge and document synchronization create substantial maintenance and protocol complexity. | Rejected for Stage 2 |

## Selected Boundary

The native-editor adapter translates `TextDocument` change events into the pure `EditorTransaction` type. VS Code offsets are UTF-16 code units; the adapter converts them to Unicode scalar offsets and rejects a range that splits a surrogate pair. Line endings are normalized to LF before policy evaluation. The Rust practice engine remains the source of truth for scoring and attempt facts in the later protocol integration.

The practice document is an untitled in-memory document. The source document that supplied the implementation is never edited. Completion keeps the controlled document visible and offers `Close` and `Restart`; Close discards it without a save prompt, while Restart creates a fresh session in the same document. An extension deactivation disposes all resources through the controller's `DisposableStore`.

The strict MVP transaction policy is:

- exactly one change and one selection per transaction;
- user insert, paste, delete, and replace are atomic and accepted only when the resulting text is a prefix of the canonical target;
- mismatches, multi-cursor edits, Undo/Redo, formatting, and external mutations request restoration of the accepted prefix;
- decorations expose accepted and remaining ranges, plus the first mismatch range when available;
- a ghost-text decoration shows the remaining current line. Leading indentation
  is summarized first as a remaining-space count such as `8sp`; ordinary editor
  Tab input advances by the user's configured indentation width. The line body
  remains hidden until indentation is complete, and `Enter` is shown at a newline;
- matching auto-closed pairs such as `()` are normalized to the user-entered opening character, and the practice document is restored to that accepted canonical prefix without changing user-level VS Code settings;
- an Enter transaction containing only a newline plus host-generated indentation is normalized to one newline; indentation remains an explicit following practice step;
- the final canonical newline remains required when the target includes one; accepting it shows `GEWU: Complete` with `Close` and `Restart`, and the document remains controlled until the user chooses;
- deleting an earlier range rewinds progress to that range's start and restores the document without retaining a non-canonical suffix;
- a terminal session ignores later edits and does not mutate its attempt facts.

The adapter must reject or restore format-on-save and other automatic mutations for practice documents. Because a VS Code change event cannot reliably expose every IME composition phase for automated tests, composition input is a release-time manual check in [the checklist](../development/vscode-spike-checklist.md). Completion UI is owned by the adapter: the controller calls a small testable callback rather than importing VS Code notification APIs.

## Automated Evidence

`editors/vscode/test/interaction.ts` tests insertion, paste, deletion, replacement, mismatch restoration, compact indentation guidance, final-newline completion and notification callback ordering, auto-closed-pair normalization, multi-cursor rejection, Undo/Redo and format policies, restart/stop/terminal lifecycle, CRLF normalization, UTF-16 to scalar conversion, Unicode scalar deletion, repeated disposal, and listener ownership. The extension adapter is statically compiled against `@types/vscode`; it cannot claim extension-host behavior until the F5 launch and manual checklist are run in a real VS Code installation.
