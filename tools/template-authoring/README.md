# GEWU Template Authoring

This package is the optional provider-backed authoring adapter for Stage 7.
It uses `@earendil-works/pi-ai` for provider selection, authentication,
streaming, and model compatibility. It does not own practice transitions or
publish content. Returned drafts remain `pending` until the Rust template
validator and explicit human review accept them.

The package intentionally imports Pi-ai only here. Rust Core and VS Code do not
depend on npm provider packages.
