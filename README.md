# gewu-algorithm

> Build algorithmic thinking through deliberate practice and cognitive frameworks.

`gewu-algorithm` is an open-source platform for deliberate algorithm practice inspired by the [Project-GEWU](https://github.com/cnkeysky/Project-GEWU) learning philosophy.

Instead of treating a solved problem or a memorized implementation as the end of learning, the project helps learners move through a progressive cycle:

```text
Position and Problem
        ->
Current Understanding
        ->
Implementation and Execution Flow
        ->
Reasoning and Pattern
        ->
Transfer and Counterexamples
        ->
Validation, Revision, and Review
```

## Status

The project is currently **pre-alpha**. The immediate goal is to validate the domain model, template format, practice engine, and VS Code shadow-typing interaction before expanding into LLM generation, knowledge graphs, synchronization, or additional editors.

No claim is currently made that this practice method improves long-term learning outcomes. The project will treat that as a question to be tested through real usage and measurable review results.

## Project Boundaries

- **Project-GEWU** defines the general learning philosophy, evidence principles, and cognitive framework practice.
- **gewu-algorithm** implements those ideas for algorithm learning and deliberate practice.
- The Rust core owns deterministic domain and practice logic.
- Editor extensions own presentation and editor integration.
- LLMs may generate drafts and analysis, but are not a source of truth.
- Personal practice records, API keys, and unreviewed generated content remain local by default.

## Initial Scope

The first usable milestone will provide:

- local, versioned `AlgorithmUnit` content;
- exact-match shadow typing for one supported editor;
- deterministic progress and error feedback;
- serialized `shadow_typing` and `flow_recall` practice modes;
- local practice history;
- a Rust core with a versioned client protocol;
- a VS Code extension as the first complete editor integration.

Zed integration remains a later compatibility target because its extension surface does not yet provide all interaction capabilities needed by the planned practice experience.

## Repository Layout

```text
gewu-algorithm/
├── crates/          # Rust domain, template, practice, protocol, storage, and core crates
├── apps/            # CLI and stdio core host
├── editors/         # VS Code and future editor adapters
├── schemas/         # Versioned public data schemas
├── packs/           # Built-in content packs during the pre-v1 phase
├── fixtures/        # Test and design fixtures
├── docs/            # Product, architecture, development, and ADR documentation
└── tests/           # Cross-component and compatibility tests
```

Directories are introduced as implementation begins. The intended architecture is documented in [docs/architecture/overview.md](docs/architecture/overview.md).

## Documentation

- [Product vision](docs/product/vision.md)
- [Requirements](docs/product/requirements.md)
- [MVP scope](docs/product/mvp.md)
- [Domain terminology](docs/architecture/terminology.md)
- [Architecture overview](docs/architecture/overview.md)
- [Local protocol](docs/architecture/protocol.md)
- [Local persistence](docs/architecture/persistence.md)
- [Domain model](docs/architecture/domain-model.md)
- [Template system](docs/architecture/template-system.md)
- [Coding standards](docs/development/coding-standards.md)
- [Testing strategy](docs/development/testing.md)
- [Architecture decisions](docs/decisions/README.md)
- [Roadmap](docs/roadmap.md)

## Contributing

The Stage 3 local MVP implementation provides a Rust core, JSON-RPC stdio host, local attempt/checkpoint persistence, deterministic `shadow_typing` and `flow_recall`, and a VS Code client. Extension-host, IME, and packaged-binary verification remain manual release checks. Before contributing, read [CONTRIBUTING.md](CONTRIBUTING.md) and the relevant architecture decision records. Changes to public schemas, the core protocol, practice scoring, or template semantics require an ADR and compatibility analysis.

## License

The project is licensed under the [MIT License](LICENSE). Third-party problem statements, solutions, datasets, and user-created practice records are not automatically covered by this license; see [NOTICE.md](NOTICE.md).
