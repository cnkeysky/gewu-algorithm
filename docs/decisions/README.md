# Architecture Decision Records

ADRs preserve important decisions and their context. They are immutable after acceptance except for typo corrections and status links. A changed decision receives a new ADR that supersedes the old one.

Statuses are `proposed`, `accepted`, `deprecated`, and `superseded`.

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-use-monorepo.md) | Begin with a monorepo | Accepted |
| [0002](0002-rust-core.md) | Use Rust for the editor-independent core | Accepted |
| [0003](0003-json-rpc-protocol.md) | Use versioned JSON-RPC over stdio for native clients | Accepted |
| [0004](0004-template-repository.md) | Keep official templates in the monorepo until schema v1 stabilizes | Accepted |
| [0005](0005-directory-naming.md) | Use concise internal directories and branded external package names | Accepted |
| [0006](0006-practice-mode-terminology.md) | Use precise practice-mode identifiers instead of Code, Flow, Thinking, and Transfer | Accepted |
| [0007](0007-vscode-native-practice-document.md) | Use a native editor with a dedicated practice document for Shadow Typing | Accepted for Stage 2 spike |
