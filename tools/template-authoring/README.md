# GEWU Template Authoring

This package is the optional provider-backed authoring adapter for Stage 7.
It uses `@earendil-works/pi-ai` for provider selection, authentication,
streaming, and model compatibility. It does not own practice transitions or
publish content. Returned drafts remain `pending` until the Rust template
validator and explicit human review accept them.

The package intentionally imports Pi-ai only here. Rust Core and VS Code do not
depend on npm provider packages.

## Provider selection and secrets

Provider/model selection is configured with `GEWU_LLM_PROVIDER` and
`GEWU_LLM_MODEL`. Credentials are never part of GEWU configuration and must be
injected through the provider's environment variable, for example
`DEEPSEEK_API_KEY`. Keep local values in the shell (or use a separate dotenv
loader such as `direnv` for an ignored `.env` file); this package does not load
`.env` implicitly. Never commit secrets or paste them into command arguments.

To run a real DeepSeek connectivity smoke test from this directory:

```sh
read -s "DEEPSEEK_API_KEY?DeepSeek API key: "; export DEEPSEEK_API_KEY; echo
GEWU_LLM_PROVIDER=deepseek GEWU_LLM_MODEL=deepseek-chat npm run smoke
unset DEEPSEEK_API_KEY
```

The command prints only a success record containing provider, model, and task
identity. It does not persist prompts, responses, or credentials. Other
providers use the same two selection variables and the credential names
defined by Pi-ai; inspect its model catalog rather than copying provider URLs
or secrets into this repository.
