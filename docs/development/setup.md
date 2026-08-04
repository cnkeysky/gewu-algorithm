# Development Setup

The implementation workspace has not been scaffolded. This document defines the setup contract that the first code change must make executable.

## Expected Toolchain

- stable Rust installed through `rustup`;
- `rustfmt` and `clippy` components;
- an active Node.js LTS release for VS Code development;
- one repository-selected Node package manager with a committed lockfile;
- VS Code for extension integration tests;
- Git.

Exact minimum versions must be pinned when the corresponding workspace is created, using repository files such as `rust-toolchain.toml`, `.nvmrc`, and `package.json#engines`.

## Required Repository Commands

The first implementation scaffold should provide memorable top-level commands for:

```text
bootstrap dependencies
format and format-check
lint
unit tests
all local checks
schema validation
VS Code integration tests
release packaging
```

Developers should not need to reconstruct CI commands from workflow YAML. CI and local scripts must invoke the same underlying commands.

## Local Data

The following data must remain outside tracked content:

- provider credentials;
- personal practice attempts;
- generated drafts;
- downloaded private templates;
- raw prompts or responses containing user code;
- test output and editor-host profiles.

Use `.env.example` only for non-secret configuration names when environment variables are introduced. Editor credentials must use secret storage rather than `.env` where possible.

## Shared Editor Settings

Only settings required for repository consistency should be committed under `.vscode/`. Personal themes, keybindings, paths, provider settings, and credentials must not be committed.
