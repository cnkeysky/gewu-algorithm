# ADR 0017: Checksummed Content Packs and Delayed Repository Split

- Status: accepted
- Date: 2026-08-05

## Decision

Content packs remain in this repository until the schema and contribution
cadence satisfy the split criteria in the template-system architecture. Packs
are distributed through a versioned manifest containing unit identity,
revision, per-unit SHA-256 checksums, and a pack inventory checksum.

Lifecycle transitions are explicit: draft -> reviewed -> validated, validated
-> deprecated or revised, and revised -> reviewed. Clients must verify the
pack manifest before loading content.

## Rationale

Checksums protect clients from partial or modified packs without coupling the
core to a package registry. A premature `gewu-algorithm-templates` repository
would duplicate unstable schema and release ownership. The split can happen
later without changing AlgorithmUnit IDs or practice contracts.
