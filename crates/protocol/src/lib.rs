#![forbid(unsafe_code)]
//! Versioned newline-delimited JSON-RPC DTOs.
//!
//! The protocol crate owns transport shapes only. Core converts these values
//! at its boundary, so DTOs do not become the domain model.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

/// Current protocol major version. A client must handshake before other calls.
pub const PROTOCOL_VERSION: u32 = 1;

/// A JSON-RPC 2.0 request carried on one UTF-8 newline-delimited frame.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub id: u64,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

impl JsonRpcRequest {
    pub fn new(id: u64, method: impl Into<String>, params: Value) -> Self {
        Self {
            jsonrpc: "2.0".to_owned(),
            id,
            method: method.into(),
            params,
        }
    }
}

/// A JSON-RPC 2.0 response carried on one UTF-8 newline-delimited frame.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    pub id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcError>,
}

impl JsonRpcResponse {
    pub fn success(id: u64, result: impl Serialize) -> Result<Self, ProtocolError> {
        Ok(Self {
            jsonrpc: "2.0".to_owned(),
            id,
            result: Some(serde_json::to_value(result)?),
            error: None,
        })
    }
    pub fn failure(id: u64, error: RpcError) -> Self {
        Self {
            jsonrpc: "2.0".to_owned(),
            id,
            result: None,
            error: Some(error),
        }
    }
}

/// A JSON-RPC failure with a numeric standard/application code and stable kind.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<RpcErrorData>,
}

impl RpcError {
    pub fn new(kind: impl Into<String>, message: impl Into<String>) -> Self {
        let kind = kind.into();
        let code = match kind.as_str() {
            "parse_error" => -32700,
            "invalid_request" => -32600,
            "method_not_found" => -32601,
            "invalid_params" => -32602,
            "internal_error" => -32603,
            _ => -32000,
        };
        Self {
            code,
            message: message.into(),
            data: Some(RpcErrorData { kind }),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RpcErrorData {
    pub kind: String,
}

/// Compatibility handshake request parameters.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct HandshakeParams {
    pub protocol_min: u32,
    pub protocol_max: u32,
    pub client_name: String,
    pub client_version: String,
}

/// Compatibility handshake result.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct HandshakeResult {
    pub protocol_version: u32,
    pub core_version: String,
}

/// Summary safe to display in a local unit picker.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct UnitSummary {
    pub id: String,
    pub revision: u64,
    pub title: String,
    pub modes: Vec<PracticeModeDto>,
}

/// The two supported v1 mode values.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PracticeModeDto {
    ShadowTyping,
    FlowRecall,
}

/// Starts a session from a loaded, versioned unit.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct StartSessionParams {
    pub unit_id: String,
    pub mode: PracticeModeDto,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub implementation: Option<String>,
}

/// Stable identity and immediately observable session state.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct StartSessionResult {
    pub session: SessionView,
}

/// Deterministic elapsed facts supplied by a client; values must be monotonic.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ElapsedDto {
    pub active_ms: u64,
    pub wall_ms: u64,
}

/// One client event applied by the Rust-owned practice state machine.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PracticeEventDto {
    InsertText {
        text: String,
    },
    DeleteRange {
        start: usize,
        end: usize,
    },
    ReplaceRange {
        start: usize,
        end: usize,
        text: String,
    },
    RevealHint {
        start: usize,
        end: usize,
    },
    SubmitAnswer {
        answer: String,
    },
    RevealPrompt,
    Restart,
}

/// Applies exactly one deterministic event.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ApplyEventParams {
    pub session_id: String,
    pub event: PracticeEventDto,
    pub elapsed: ElapsedDto,
}

/// Stops an active session and creates a terminal attempt.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct StopSessionParams {
    pub session_id: String,
    pub elapsed: ElapsedDto,
}

/// Session state returned after start, event, resume, or stop.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct SessionView {
    pub session_id: String,
    pub unit_id: String,
    pub unit_title: String,
    pub problem_question: String,
    pub revision: u64,
    pub mode: PracticeModeDto,
    pub status: SessionStatusDto,
    pub accepted_text: String,
    pub target_text: String,
    pub current_prompt: Option<String>,
    pub completed_prompts: Vec<String>,
    pub completed_steps: usize,
    pub total_steps: usize,
    pub accepted_input_count: u64,
    pub rejected_input_count: u64,
    pub correction_count: u64,
    pub prompt_count: u64,
    pub active_ms: u64,
    pub wall_ms: u64,
    pub terminal_reason: Option<TerminalReasonDto>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionStatusDto {
    Active,
    Completed,
    Stopped,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TerminalReasonDto {
    Completed,
    Stopped,
}

/// Serializable attempt summary. It excludes source text and answer text.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct AttemptSummary {
    pub id: String,
    pub created_at: String,
    pub unit_id: String,
    pub revision: u64,
    pub schema_version: String,
    pub mode: PracticeModeDto,
    pub terminal_reason: TerminalReasonDto,
    pub accepted_input_count: u64,
    pub rejected_input_count: u64,
    pub correction_count: u64,
    pub prompt_count: u64,
    pub active_ms: u64,
    pub wall_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RecentAttemptsParams {
    #[serde(default = "default_limit")]
    pub limit: usize,
}
fn default_limit() -> usize {
    20
}
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RecentAttemptsResult {
    pub attempts: Vec<AttemptSummary>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct DeleteHistoryResult {
    pub deleted_attempts: usize,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct DeleteAttemptsParams {
    pub ids: Vec<String>,
}

/// Saves an active versioned-unit checkpoint.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct CheckpointParams {
    pub session_id: String,
}

/// Stable checkpoint identity used for explicit recovery or removal.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct CheckpointIdParams {
    pub checkpoint_id: String,
}

/// A recoverable interrupted session without replayable event contents.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct CheckpointSummary {
    pub id: String,
    pub unit_id: String,
    pub unit_title: String,
    pub revision: u64,
    pub mode: PracticeModeDto,
    pub completed_steps: usize,
    pub total_steps: usize,
    pub accepted_characters: usize,
    pub target_characters: usize,
    pub saved_at: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ListCheckpointsResult {
    pub checkpoints: Vec<CheckpointSummary>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ResumeCheckpointResult {
    pub session: Option<SessionView>,
}

/// Protocol serialization or frame validation failure.
#[derive(Debug, Error)]
pub enum ProtocolError {
    #[error("could not serialize protocol value: {0}")]
    Serialize(#[from] serde_json::Error),
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn serializes_the_v1_handshake_golden_shape() {
        let request = JsonRpcRequest::new(
            1,
            "gewu/handshake",
            json!({
                "protocol_min": 1,
                "protocol_max": 1,
                "client_name": "fixture",
                "client_version": "0.1.0"
            }),
        );
        let fixture = include_str!("../../../fixtures/protocol/v1-handshake.ndjson");
        let expected = fixture
            .lines()
            .next()
            .unwrap_or_else(|| panic!("golden request"));
        assert_eq!(
            serde_json::to_string(&request).unwrap_or_else(|error| panic!("serialize: {error}")),
            expected
        );
    }

    #[test]
    fn uses_json_rpc_numeric_error_codes_and_a_stable_kind() {
        let response =
            JsonRpcResponse::failure(7, RpcError::new("method_not_found", "unsupported method"));
        let value = serde_json::to_value(response)
            .unwrap_or_else(|error| panic!("serialize response: {error}"));
        assert_eq!(value["error"]["code"], -32601);
        assert_eq!(value["error"]["data"]["kind"], "method_not_found");
    }
}
