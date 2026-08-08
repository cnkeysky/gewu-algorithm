use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::PathBuf,
};

use gewu_core::Core;
use gewu_protocol::{JsonRpcRequest, JsonRpcResponse, RpcError};

pub fn run(content_roots: Vec<PathBuf>, data_root: PathBuf, port: String) -> Result<(), String> {
    let listener =
        TcpListener::bind(("127.0.0.1", port.parse::<u16>().map_err(|e| e.to_string())?))
            .map_err(|error| error.to_string())?;
    eprintln!("GEWU HTTP core listening on http://127.0.0.1:{port}");
    let mut core = Core::open_roots(content_roots, data_root).map_err(|error| error.to_string())?;
    let mut handshaken = false;
    for stream in listener.incoming() {
        let mut stream = match stream {
            Ok(stream) => stream,
            Err(error) => {
                eprintln!("GEWU HTTP accept failed: {error}");
                continue;
            }
        };
        if let Err(error) = handle(&mut stream, &mut core, &mut handshaken) {
            // The client may have disconnected while we were reading or
            // writing; a per-connection failure must not take down the whole
            // server (a broken pipe used to exit the host mid-run).
            let response = JsonRpcResponse::failure(0, RpcError::new("invalid_request", error));
            if let Err(write_error) = write_json(&mut stream, &response) {
                eprintln!("GEWU HTTP error response failed: {write_error}");
            }
        }
    }
    Ok(())
}

fn handle(stream: &mut TcpStream, core: &mut Core, handshaken: &mut bool) -> Result<(), String> {
    let request = read_request(stream)?;
    if request.method == "GET" && request.path == "/health" {
        write_response(stream, 200, "{\"status\":\"ok\"}")?;
        return Ok(());
    }
    if request.method == "OPTIONS" {
        write_response(stream, 204, "")?;
        return Ok(());
    }
    if request.method != "POST" || request.path != "/rpc" {
        write_response(stream, 404, "{\"error\":\"use POST /rpc\"}")?;
        return Ok(());
    }
    let parsed = serde_json::from_slice::<JsonRpcRequest>(&request.body)
        .map_err(|error| format!("invalid JSON-RPC request: {error}"))?;
    let response = crate::dispatch(core, handshaken, parsed);
    write_json(stream, &response)
}

struct Request {
    method: String,
    path: String,
    body: Vec<u8>,
}

fn read_request(stream: &mut TcpStream) -> Result<Request, String> {
    let mut bytes = Vec::new();
    let mut buffer = [0_u8; 8192];
    let header_end;
    loop {
        let count = stream
            .read(&mut buffer)
            .map_err(|error| error.to_string())?;
        if count == 0 {
            return Err("connection closed before request headers".to_owned());
        }
        bytes.extend_from_slice(&buffer[..count]);
        if let Some(position) = bytes.windows(4).position(|window| window == b"\r\n\r\n") {
            header_end = position + 4;
            break;
        }
        if bytes.len() > 64 * 1024 {
            return Err("request headers are too large".to_owned());
        }
    }
    let headers = String::from_utf8(bytes[..header_end].to_vec())
        .map_err(|_| "request headers are not UTF-8".to_owned())?;
    let mut lines = headers.split("\r\n");
    let first = lines
        .next()
        .ok_or_else(|| "request line is missing".to_owned())?;
    let mut parts = first.split_whitespace();
    let method = parts.next().unwrap_or_default().to_owned();
    let path = parts.next().unwrap_or_default().to_owned();
    let content_length = lines
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            (name.eq_ignore_ascii_case("content-length"))
                .then(|| value.trim().parse::<usize>().ok())
                .flatten()
        })
        .unwrap_or(0);
    if content_length > 1_000_000 {
        return Err("request body is too large".to_owned());
    }
    let mut body = bytes[header_end..].to_vec();
    while body.len() < content_length {
        let count = stream
            .read(&mut buffer)
            .map_err(|error| error.to_string())?;
        if count == 0 {
            return Err("request body ended early".to_owned());
        }
        body.extend_from_slice(&buffer[..count]);
    }
    body.truncate(content_length);
    Ok(Request { method, path, body })
}

fn write_json(stream: &mut TcpStream, value: &impl serde::Serialize) -> Result<(), String> {
    let body = serde_json::to_vec(value).map_err(|error| error.to_string())?;
    write_response_bytes(stream, 200, &body)
}
fn write_response(stream: &mut TcpStream, status: u16, body: &str) -> Result<(), String> {
    write_response_bytes(stream, status, body.as_bytes())
}
fn write_response_bytes(stream: &mut TcpStream, status: u16, body: &[u8]) -> Result<(), String> {
    let reason = match status {
        200 => "OK",
        204 => "No Content",
        404 => "Not Found",
        _ => "Error",
    };
    let headers = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json; charset=utf-8\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: content-type\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream
        .write_all(headers.as_bytes())
        .map_err(|error| error.to_string())?;
    stream.write_all(body).map_err(|error| error.to_string())
}
