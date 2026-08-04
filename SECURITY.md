# Security Policy

## Supported Versions

The project has not published a stable release. Security fixes currently apply only to the latest `main` branch.

## Reporting a Vulnerability

Do not open a public issue containing API keys, private code, personal practice data, or a working exploit. Contact the repository owner privately through an available GitHub security reporting channel.

Include:

- affected component and revision;
- reproduction conditions;
- expected impact;
- whether secrets or user content may be exposed;
- any temporary mitigation already identified.

## Security Principles

- API keys must use editor or operating-system secret storage.
- Secrets must never be written to logs, templates, fixtures, or workspace settings.
- LLM requests must be explicit about what content leaves the local machine.
- Remote content is untrusted input and must not control prompts, filesystem paths, or command execution.
- Generated code and templates remain drafts until validated.
- Telemetry, if introduced, must be documented, minimal, and opt-in by default.
