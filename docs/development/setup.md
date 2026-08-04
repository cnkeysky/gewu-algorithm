# Development Setup

The Rust workspace contains the domain, template, and practice crates. The Stage 2 VS Code spike lives under `editors/vscode` and includes a minimal extension host entry point; it does not yet launch the Rust core.

## Expected Toolchain

- the system's current stable Rust toolchain installed through `rustup` (1.97.1 when this workspace was initialized), selected by `rust-toolchain.toml`;
- `rustfmt` and `clippy` components;
- an active Node.js LTS release for VS Code development;
- one repository-selected Node package manager with a committed lockfile;
- VS Code for extension integration tests;
- Git.

The repository initially uses the tool versions available in the development environment and selects them through files such as `rust-toolchain.toml`, `.nvmrc`, and `package.json#engines`. Supporting an older Rust MSRV requires a separate compatibility decision and CI coverage; the selected toolchain must not be lowered speculatively.

## Current Rust Checks

Run the complete current Rust gate from the repository root:

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

`Cargo.lock` is committed because this repository produces applications and editor tooling, not only reusable libraries.

## VS Code Spike Checks

From `editors/vscode`, using the system-provided Node.js `v24.15.0` and npm `11.17.0`:

```bash
npm install
npm run format
npm run lint
npm run typecheck
npm test
```

Open the repository root in VS Code and press F5 with `Run GEWU Interaction Spike` to run the extension-development-host entry point. Host and IME behavior remains a manual release check; the current environment may not provide a working VS Code host.

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
