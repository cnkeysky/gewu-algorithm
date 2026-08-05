# ADR 0014: Provider-Neutral LLM Boundary

Status: accepted

## Context

Project-GEWU content generation may use OpenAI, DeepSeek, Moonshot/Kimi,
Zhipu/GLM, Xiaomi MiMo, Pi-compatible endpoints, or a local gateway. Their
protocols overlap but are not identical, and a provider SDK must not become part
of deterministic content validation or practice execution.

## Decision

`gewu-llm` owns typed generation tasks, structured-output parsing, fake
providers, and review-gated draft artifacts. The TypeScript authoring bridge
depends on `@earendil-works/pi-ai` for provider/model/auth/streaming behavior.
Network transports and vendor SDKs stay outside the Rust core contract. GEWU
does not depend on Pi's agent loop or session runtime.

## Consequences

Provider changes do not change AlgorithmUnit or practice contracts. Common
capabilities remain small and testable; provider-specific tools, reasoning,
streaming, and multimodal fields require explicit extensions. Credentials and raw
prompts/responses remain deployment data, not repository artifacts.
