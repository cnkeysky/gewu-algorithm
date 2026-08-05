# Template System

## Ownership

The template system has two distinct assets:

1. the `AlgorithmUnit` schema and loaders, owned by `gewu-algorithm`;
2. reusable algorithm content packs, initially stored under `packs/` and potentially moved to `gewu-algorithm-templates` after the schema stabilizes.

Personal units and generated drafts are not official content packs.

## Package Layout

```text
pack.yaml
units/
└── graph/
    └── bfs/
        ├── unit.yaml
        ├── code/
        │   ├── python.py
        │   └── cpp.cpp
        ├── practice/
        │   ├── shadow.yaml
        │   └── flow.yaml
        ├── examples/
        ├── counterexamples/
        └── tests/
```

The manifest contains identity and structured semantics. Source code remains in normal language files so formatters, compilers, syntax highlighting, and diffs work naturally.

Practice content follows the platform-independent contracts in
[Practice Content Contracts](practice-content-contracts.md). In particular,
comment-guided reconstruction, keyword hints, structural skeletons, and cloze
regions are assistance policies for `code_recall`, not editor features or new
persisted practice modes.

## Authoring Rules

- Human-authored YAML is validated against a versioned JSON Schema.
- Required fields must justify deterministic behavior, compatibility, provenance, or meaningful learning value.
- Markdown may explain a unit but is not the sole source for machine-required semantics.
- Relationships include a reason and boundary.
- Transfer examples include what structure transfers and what differs.
- Counterexamples identify cases where a tempting pattern is invalid or insufficient.
- Published code variants include executable tests where practical.
- Generated content remains under local draft storage until reviewed.
- Generation tasks may emit only fields defined by an implemented schema
  contract; a provider response cannot extend practice semantics implicitly.
- One generation task emits one `AlgorithmUnit` aggregate with every applicable
  practice definition. It does not emit separate templates per practice mode.
- Generated implementation variants declare strategy, complexity, assumptions,
  and contained test references. Content cannot provide shell commands.
- Model reviewers are read-only. They emit versioned findings and repair
  handoffs; they cannot promote or publish a draft.

## Schema Evolution

- Schema versions use a positive major version represented as a string.
- Additive optional fields may remain within a compatible schema release.
- New required fields or semantic changes require a new major schema version and migration plan.
- Loaders report unsupported versions rather than guessing.
- Fixtures cover the oldest supported and current versions.

## Official Pack Split Criteria

Moving official content to a separate repository should occur only when most of these conditions hold:

- schema version 1 is stable;
- at least 30 to 50 maintained units exist;
- content and code have meaningfully different review cadence;
- independent consumers need the content;
- content contributors do not need the software workspace;
- licensing and provenance checks have their own maintainers;
- releases can be tagged and compatibility-tested independently.

Until then, a monorepo avoids synchronized changes across unstable contracts.

## Distribution

Git is the authoring and review mechanism. `gewu-template pack build` emits a
versioned JSON manifest with SHA-256 hashes for every unit directory and the
pack inventory; `gewu-template pack verify` validates those hashes before a
runtime consumes the pack. Runtime clients should consume a tagged,
checksummed content-pack artifact or an explicitly selected local directory.
Git submodules are not the default distribution mechanism because they make
installation and version resolution harder for ordinary users.
