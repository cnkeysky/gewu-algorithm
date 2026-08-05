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

## Local Run

Start the core from the repository root:

```bash
cargo run -p gewu-cli -- serve \
  --content-root fixtures/algorithm-units/valid \
  --data-root .gewu-data
```

Then start the Vite workbench:

```bash
cd tools/template-authoring
npm run workbench:dev
```

Open `http://127.0.0.1:5173/` and select `Practice`. The workspace supports
all current modes, selected `practice_id`, typed submit/stop events, resume or
discard for each checkpoint, recent attempts, and review recommendations.

This local HTTP adapter is intentionally bound to loopback and has no remote
authentication or network exposure. It is a development/reference host, not a
production daemon.
