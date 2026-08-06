#![forbid(unsafe_code)]

mod http;

use std::{
    env,
    io::{self, BufRead, Write},
    path::PathBuf,
};

use gewu_core::{CORE_VERSION, Core};
use gewu_protocol::{
    ApplyEventParams, CheckpointIdParams, CheckpointParams, DeleteAttemptsParams,
    DeleteHistoryResult, HandshakeParams, HandshakeResult, JsonRpcRequest, JsonRpcResponse,
    ListCheckpointsResult, PROTOCOL_VERSION, RecentAttemptsParams, RecentAttemptsResult, RpcError,
    StartSessionParams, StopSessionParams,
};
use serde::Deserialize;
use serde_json::{Value, json};

fn main() {
    let arguments: Vec<String> = env::args().skip(1).collect();
    let command = arguments.first().map(String::as_str).unwrap_or("help");
    let content_roots = content_roots_from(&arguments);
    let data_root = option_value(&arguments, "--data-root")
        .map(PathBuf::from)
        .unwrap_or_else(default_data_root);
    let http_port = option_value(&arguments, "--port")
        .map(str::to_owned)
        .or_else(|| env::var("GEWU_HTTP_PORT").ok())
        .unwrap_or_else(|| "4175".to_owned());
    match command {
        "stdio" => {
            if let Err(error) = run_stdio(content_roots, data_root) {
                eprintln!("GEWU core host failed: {error}");
                std::process::exit(1);
            }
        }
        "serve" => {
            if let Err(error) = http::run(content_roots, data_root, http_port) {
                eprintln!("GEWU HTTP core host failed: {error}");
                std::process::exit(1);
            }
        }
        "list-units" => {
            match Core::open_roots(content_roots, data_root).and_then(|core| core.list_units()) {
                Ok(units) => print_json(&units),
                Err(error) => fail(&error.to_string()),
            }
        }
        "recent-attempts" => {
            match Core::open_roots(content_roots, data_root).and_then(|core| core.recent_attempts(20)) {
                Ok(attempts) => print_json(&attempts),
                Err(error) => fail(&error.to_string()),
            }
        }
        // Projects deterministic review recommendations without starting an editor.
        "review" => {
            match Core::open_roots(content_roots, data_root)
                .and_then(|core| core.review_recommendations(100))
            {
                Ok(recommendations) => print_json(&recommendations),
                Err(error) => fail(&error.to_string()),
            }
        }
        "delete-history" => {
            match Core::open_roots(content_roots, data_root).and_then(|core| core.delete_history()) {
                Ok(deleted_attempts) => print_json(&DeleteHistoryResult { deleted_attempts }),
                Err(error) => fail(&error.to_string()),
            }
        }
        _ => print_help(),
    }
}

fn run_stdio(content_roots: Vec<PathBuf>, data_root: PathBuf) -> Result<(), String> {
    let mut core = Core::open_roots(content_roots, data_root).map_err(|error| error.to_string())?;
    let stdin = io::stdin();
    let mut handshaken = false;
    for line in stdin.lock().lines() {
        let line = line.map_err(|error| error.to_string())?;
        if line.trim().is_empty() {
            continue;
        }
        let response = match serde_json::from_str::<JsonRpcRequest>(&line) {
            Ok(request) => dispatch(&mut core, &mut handshaken, request),
            Err(error) => {
                JsonRpcResponse::failure(0, RpcError::new("parse_error", error.to_string()))
            }
        };
        let encoded = serde_json::to_string(&response).map_err(|error| error.to_string())?;
        println!("{encoded}");
        io::stdout().flush().map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub(crate) fn dispatch(
    core: &mut Core,
    handshaken: &mut bool,
    request: JsonRpcRequest,
) -> JsonRpcResponse {
    if request.jsonrpc != "2.0" {
        return JsonRpcResponse::failure(
            request.id,
            RpcError::new("invalid_request", "jsonrpc must equal 2.0"),
        );
    }
    let id = request.id;
    let result = match request.method.as_str() {
        "gewu/handshake" => decode::<HandshakeParams>(request.params).and_then(|params| {
            if params.protocol_min > PROTOCOL_VERSION || params.protocol_max < PROTOCOL_VERSION {
                return Err(RpcError::new(
                    "incompatible_protocol",
                    format!(
                        "client protocol range {}..={} is incompatible with core protocol {}",
                        params.protocol_min, params.protocol_max, PROTOCOL_VERSION
                    ),
                ));
            }
            *handshaken = true;
            value(HandshakeResult {
                protocol_version: PROTOCOL_VERSION,
                core_version: CORE_VERSION.to_owned(),
            })
        }),
        _ if !*handshaken => Err(RpcError::new(
            "handshake_required",
            "call gewu/handshake before other methods",
        )),
        "gewu/listUnits" => core.list_units().map_err(core_error).and_then(value),
        "gewu/loadUnit" => decode::<UnitIdParams>(request.params)
            .and_then(|params| core.load_unit(&params.unit_id).map_err(core_error))
            .and_then(value),
        "gewu/startSession" => decode::<StartSessionParams>(request.params)
            .and_then(|params| core.start_session(params).map_err(core_error))
            .and_then(|session| value(json!({"session": session}))),
        "gewu/applyEvent" => decode::<ApplyEventParams>(request.params)
            .and_then(|params| core.apply_event(params).map_err(core_error))
            .and_then(|session| value(json!({"session": session}))),
        "gewu/stopSession" => decode::<StopSessionParams>(request.params)
            .and_then(|params| {
                core.stop_session(&params.session_id, params.elapsed)
                    .map_err(core_error)
            })
            .and_then(|session| value(json!({"session": session}))),
        "gewu/restartSession" => decode::<CheckpointParams>(request.params)
            .and_then(|params| core.restart_session(&params.session_id).map_err(core_error))
            .and_then(|session| value(json!({"session": session}))),
        "gewu/recentAttempts" => decode::<RecentAttemptsParams>(request.params)
            .and_then(|params| core.recent_attempts(params.limit).map_err(core_error))
            .and_then(|attempts| value(RecentAttemptsResult { attempts })),
        "gewu/reviewRecommendations" => core
            .review_recommendations(100)
            .map_err(core_error)
            .and_then(value),
        "gewu/deleteHistory" => core
            .delete_history()
            .map_err(core_error)
            .and_then(|deleted_attempts| value(DeleteHistoryResult { deleted_attempts })),
        "gewu/deleteAttempts" => decode::<DeleteAttemptsParams>(request.params)
            .and_then(|params| core.delete_attempts(&params.ids).map_err(core_error))
            .and_then(|deleted_attempts| value(DeleteHistoryResult { deleted_attempts })),
        "gewu/saveCheckpoint" => decode::<CheckpointParams>(request.params)
            .and_then(|params| core.save_checkpoint(&params.session_id).map_err(core_error))
            .and_then(|()| value(json!({}))),
        "gewu/listCheckpoints" => core
            .list_checkpoints()
            .map_err(core_error)
            .and_then(|checkpoints| value(ListCheckpointsResult { checkpoints })),
        "gewu/resumeCheckpoint" => decode::<CheckpointIdParams>(request.params)
            .and_then(|params| {
                core.resume_checkpoint(&params.checkpoint_id)
                    .map_err(core_error)
            })
            .and_then(|session| value(json!({"session": session}))),
        "gewu/discardCheckpoint" => decode::<CheckpointIdParams>(request.params)
            .and_then(|params| {
                core.discard_checkpoint(&params.checkpoint_id)
                    .map_err(core_error)
            })
            .and_then(|_| value(json!({}))),
        _ => Err(RpcError::new(
            "method_not_found",
            "unsupported GEWU protocol method",
        )),
    };
    match result {
        Ok(result) => JsonRpcResponse::success(id, result).unwrap_or_else(|error| {
            JsonRpcResponse::failure(id, RpcError::new("internal_error", error.to_string()))
        }),
        Err(error) => JsonRpcResponse::failure(id, error),
    }
}

#[derive(Deserialize)]
struct UnitIdParams {
    unit_id: String,
}
fn decode<T: for<'de> Deserialize<'de>>(value: Value) -> Result<T, RpcError> {
    serde_json::from_value(value)
        .map_err(|error| RpcError::new("invalid_params", error.to_string()))
}
fn value(value: impl serde::Serialize) -> Result<Value, RpcError> {
    serde_json::to_value(value).map_err(|error| RpcError::new("internal_error", error.to_string()))
}
fn core_error(error: gewu_core::CoreError) -> RpcError {
    RpcError::new("core_error", error.to_string())
}
fn option_value<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
    args.windows(2)
        .find(|window| window[0] == name)
        .map(|window| window[1].as_str())
}
fn content_roots_from(arguments: &[String]) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    let mut index = 0;
    while index < arguments.len() {
        if arguments[index] == "--content-root" {
            if let Some(value) = arguments.get(index + 1) {
                roots.push(PathBuf::from(value));
                index += 2;
                continue;
            }
        }
        index += 1;
    }
    if roots.is_empty() {
        roots.push(default_content_root());
    }
    roots
}
fn default_content_root() -> PathBuf {
    env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("fixtures/algorithm-units/valid")
}
fn default_data_root() -> PathBuf {
    env::var_os("GEWU_DATA_DIR")
        .map(PathBuf::from)
        .or_else(|| {
            env::var_os("XDG_DATA_HOME").map(|root| PathBuf::from(root).join("gewu-algorithm"))
        })
        .or_else(|| {
            env::var_os("HOME").map(|root| PathBuf::from(root).join(".local/share/gewu-algorithm"))
        })
        .unwrap_or_else(|| PathBuf::from(".gewu-data"))
}
fn print_json(value: &impl serde::Serialize) {
    match serde_json::to_string_pretty(value) {
        Ok(value) => println!("{value}"),
        Err(error) => fail(&error.to_string()),
    }
}
fn fail(message: &str) {
    eprintln!("GEWU: {message}");
    std::process::exit(1);
}
fn print_help() {
    println!(
        "gewu <stdio|serve|list-units|recent-attempts|review|delete-history> [--content-root PATH] [--data-root PATH] [--port PORT]"
    );
}
