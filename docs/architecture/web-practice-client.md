# Web Practice Client

The first-party Web client is the reference host for GEWU practice. It shares
the Vite workbench with template authoring but has a separate `Practice`
workspace. Authoring and practice remain different bounded contexts.

```text
Vite Web (127.0.0.1:5173)
        | POST /rpc, JSON-RPC 2.0
        v
Rust Core HTTP adapter (127.0.0.1:4175)
        |
        v
Core state machines + LocalStore
```

The browser only renders Core-returned state and sends typed protocol events.
It does not score text, decide completion, write checkpoints, or persist
attempt facts. The HTTP adapter is a transport host around the existing CLI
dispatch and does not introduce a second application API.

## Editor Transaction Boundary

Monaco owns the transient text buffer, selection, cursor, undo stack, and
scroll position. Each user action is normalized as one incremental
`ShadowEdit` (`start`, `end`, `text`) and submitted to Core against the last
confirmed text boundary. Core remains authoritative for acceptance and
practice transitions; a confirmed response must not replace the editor model
or reset its cursor when the submitted edit is still present locally.

Full text snapshots are used only when starting, resuming, rejecting, or
reconnecting a session. They are synchronization checkpoints, not the normal
keystroke protocol. This keeps Enter, deletion, paste, and future selection
editing as ordinary Monaco transactions without introducing a CRDT/OT layer.

## Local Run

Start the core from the repository root:

```bash
cargo run -p gewu-cli -- serve \
  --port 4175 \
  --content-root fixtures/algorithm-units/valid \
  --data-root .gewu-data
```

Then start the Vite workbench:

```bash
cd tools/template-authoring
npm run workbench:dev
```

Ports can be overridden without editing source files. Vite accepts its native
`--port` argument, while the proxy targets use environment overrides:

```bash
cargo run -p gewu-cli -- serve --port 4185 \
  --content-root fixtures/algorithm-units/valid \
  --data-root .gewu-data

cd tools/template-authoring/workbench
GEWU_CORE_PORT=4185 npm run dev -- --port 5183
```

`GEWU_AUTHORING_PORT` overrides the authoring API port. The corresponding
`GEWU_CORE_TARGET` and `GEWU_AUTHORING_TARGET` variables accept complete target
URLs for advanced proxy setups and take precedence over the port variables.

Open `http://127.0.0.1:5173/` and select `Practice`. The workspace supports
all current modes, selected `practice_id`, typed submit/stop events, resume or
discard for each checkpoint, recent attempts, and review recommendations.

This local HTTP adapter is intentionally bound to loopback and has no remote
authentication or network exposure. It is a development/reference host, not a
production daemon.
