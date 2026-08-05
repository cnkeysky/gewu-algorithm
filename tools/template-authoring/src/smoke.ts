import { PiGenerator, optionsFromEnvironment } from "./pi-generator.js";

const generator = new PiGenerator(optionsFromEnvironment());

const artifact = await generator.generate({
  taskId: "llm-provider-smoke",
  taskVersion: "1",
  selectedInputHash: "local-smoke",
  instruction:
    "Return only a JSON object with ok=true and a short provider_check string. Do not include markdown.",
  outputSchema: {
    type: "object",
    properties: { ok: { type: "boolean" }, provider_check: { type: "string" } },
    required: ["ok", "provider_check"],
    additionalProperties: false,
  },
});

if (artifact.manifest.ok !== true) throw new Error("Provider smoke response did not contain ok=true");
console.log(JSON.stringify({
  status: "ok",
  provider: artifact.provider,
  model: artifact.model,
  taskId: artifact.taskId,
}));
