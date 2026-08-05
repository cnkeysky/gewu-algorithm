#![forbid(unsafe_code)]
//! Provider-neutral LLM contracts. Network transports and vendor SDKs stay outside this crate.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;
use thiserror::Error;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderKind {
    OpenAi,
    DeepSeek,
    Moonshot,
    Zhipu,
    XiaomiMiMo,
    Custom,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ProviderProfile {
    pub provider: ProviderKind,
    pub model: String,
    /// Pi-ai API identifier, for example `openai-completions` or `openai-responses`.
    pub api: String,
}

impl ProviderProfile {
    pub fn recommended(provider: ProviderKind, model: impl Into<String>) -> Self {
        let model = model.into();
        let api = if provider == ProviderKind::OpenAi {
            "openai-responses"
        } else {
            "openai-completions"
        };
        Self {
            provider,
            model,
            api: api.to_owned(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct GenerationRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    pub response_schema: Option<Value>,
    pub temperature: Option<f32>,
    pub max_output_tokens: Option<u32>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct GenerationResponse {
    pub provider: ProviderKind,
    pub model: String,
    pub text: String,
    pub raw: Option<Value>,
}

pub trait LlmProvider {
    fn profile(&self) -> &ProviderProfile;
    fn generate(&mut self, request: &GenerationRequest) -> Result<GenerationResponse, LlmError>;
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct DraftTask {
    pub task_id: String,
    pub task_version: String,
    pub selected_input_hash: String,
    pub instruction: String,
    pub output_schema: Value,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ReviewState {
    Pending,
    Accepted,
    Rejected,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct DraftArtifact {
    pub task_id: String,
    pub task_version: String,
    pub selected_input_hash: String,
    pub provider: ProviderKind,
    pub model: String,
    pub manifest: Value,
    pub review: ReviewState,
}

impl DraftArtifact {
    pub fn review(mut self, state: ReviewState) -> Result<Self, LlmError> {
        if state == ReviewState::Pending {
            return Err(LlmError::InvalidRequest(
                "a review decision must be accepted or rejected".to_owned(),
            ));
        }
        self.review = state;
        Ok(self)
    }

    pub fn persist_manifest(&self, path: impl AsRef<Path>) -> Result<(), LlmError> {
        if self.review != ReviewState::Accepted {
            return Err(LlmError::InvalidRequest(
                "only an accepted draft may be published".to_owned(),
            ));
        }
        let bytes = serde_json::to_vec_pretty(&self.manifest)
            .map_err(|error| LlmError::InvalidStructuredOutput(error.to_string()))?;
        std::fs::write(path, bytes).map_err(|error| LlmError::InvalidRequest(error.to_string()))
    }
}

pub struct DraftPipeline<P> {
    provider: P,
}

impl<P: LlmProvider> DraftPipeline<P> {
    pub fn new(provider: P) -> Self {
        Self { provider }
    }
    pub fn provider(&self) -> &P {
        &self.provider
    }
    pub fn generate(&mut self, task: &DraftTask) -> Result<DraftArtifact, LlmError> {
        if task.task_id.trim().is_empty()
            || task.task_version.trim().is_empty()
            || task.selected_input_hash.trim().is_empty()
        {
            return Err(LlmError::InvalidRequest(
                "task identity and selected input hash are required".to_owned(),
            ));
        }
        let request = GenerationRequest {
            model: self.provider.profile().model.clone(),
            messages: vec![ChatMessage {
                role: "user".to_owned(),
                content: task.instruction.clone(),
            }],
            response_schema: Some(task.output_schema.clone()),
            temperature: Some(0.0),
            max_output_tokens: Some(8192),
        };
        let response = self.provider.generate(&request)?;
        let manifest = serde_json::from_str(&response.text)
            .map_err(|error| LlmError::InvalidStructuredOutput(error.to_string()))?;
        Ok(DraftArtifact {
            task_id: task.task_id.clone(),
            task_version: task.task_version.clone(),
            selected_input_hash: task.selected_input_hash.clone(),
            provider: response.provider,
            model: response.model,
            manifest,
            review: ReviewState::Pending,
        })
    }
}

#[derive(Debug, Error)]
pub enum LlmError {
    #[error("provider transport is not configured")]
    TransportUnavailable,
    #[error("provider returned malformed structured output: {0}")]
    InvalidStructuredOutput(String),
    #[error("provider request is invalid: {0}")]
    InvalidRequest(String),
}

pub struct FakeProvider {
    profile: ProviderProfile,
    responses: Vec<String>,
}

impl FakeProvider {
    pub fn new(profile: ProviderProfile, responses: Vec<String>) -> Self {
        Self { profile, responses }
    }
}

impl LlmProvider for FakeProvider {
    fn profile(&self) -> &ProviderProfile {
        &self.profile
    }
    fn generate(&mut self, request: &GenerationRequest) -> Result<GenerationResponse, LlmError> {
        let text = self.responses.pop().ok_or(LlmError::TransportUnavailable)?;
        if request.response_schema.is_some() {
            serde_json::from_str::<Value>(&text)
                .map_err(|error| LlmError::InvalidStructuredOutput(error.to_string()))?;
        }
        Ok(GenerationResponse {
            provider: self.profile.provider,
            model: request.model.clone(),
            text,
            raw: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profiles_capture_vendor_specific_defaults_without_sdk_types() {
        let deepseek = ProviderProfile::recommended(ProviderKind::DeepSeek, "deepseek-chat");
        assert_eq!(deepseek.api, "openai-completions");
        let openai = ProviderProfile::recommended(ProviderKind::OpenAi, "gpt-5.6-terra");
        assert_eq!(openai.api, "openai-responses");
    }

    #[test]
    fn fake_provider_is_deterministic() {
        let profile = ProviderProfile::recommended(ProviderKind::Moonshot, "kimi-k2.6");
        let request = GenerationRequest {
            model: "kimi-k2.6".to_owned(),
            messages: vec![ChatMessage {
                role: "user".to_owned(),
                content: "draft".to_owned(),
            }],
            response_schema: Some(serde_json::json!({"type":"object"})),
            temperature: Some(0.0),
            max_output_tokens: Some(100),
        };
        let mut fake = FakeProvider::new(profile, vec!["{\"draft\":true}".to_owned()]);
        assert_eq!(
            fake.generate(&request).expect("fake response").text,
            "{\"draft\":true}"
        );
    }

    #[test]
    fn draft_pipeline_requires_review_before_publication() {
        let profile = ProviderProfile::recommended(ProviderKind::DeepSeek, "deepseek-chat");
        let mut pipeline = DraftPipeline::new(FakeProvider::new(
            profile,
            vec!["{\"schema_version\":\"1\"}".to_owned()],
        ));
        let task = DraftTask {
            task_id: "algorithm-unit-draft".to_owned(),
            task_version: "1".to_owned(),
            selected_input_hash: "sha256:input".to_owned(),
            instruction: "Return a unit manifest".to_owned(),
            output_schema: serde_json::json!({"type":"object"}),
        };
        let artifact = pipeline.generate(&task).expect("draft");
        assert_eq!(artifact.review, ReviewState::Pending);
        assert_eq!(artifact.manifest["schema_version"], "1");
        assert!(
            artifact
                .persist_manifest("/tmp/gewu-stage7-pending.json")
                .is_err()
        );
        let accepted = artifact.review(ReviewState::Accepted).expect("review");
        accepted
            .persist_manifest("/tmp/gewu-stage7-accepted.json")
            .expect("persist");
        let written: Value = serde_json::from_str(
            &std::fs::read_to_string("/tmp/gewu-stage7-accepted.json").expect("read"),
        )
        .expect("json");
        assert_eq!(written["schema_version"], "1");
        let _ = std::fs::remove_file("/tmp/gewu-stage7-accepted.json");
    }
}
