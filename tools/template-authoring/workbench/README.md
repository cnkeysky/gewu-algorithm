# GEWU Authoring Workbench

This Vite + TypeScript client is the local authoring and practice surface for
GEWU. It includes template draft/review workflows and the first-party browser
host for the Rust-owned practice state machines.

Run it from this directory with:

```sh
npm install
npm run dev
```

Vite's port and local proxy targets can be overridden without editing source:

```sh
GEWU_CORE_PORT=4185 GEWU_AUTHORING_PORT=4174 npm run dev -- --port 5183
```

Complete proxy URLs can be supplied with `GEWU_CORE_TARGET` and
`GEWU_AUTHORING_TARGET`; they take precedence over the port variables.

Install the Playwright browser once, then run the isolated browser tests:

```sh
npx playwright install chromium
npm run test:e2e
```

The E2E runner starts Core and Vite on `4185` and `5183` by default with a
temporary data directory. Override them with `GEWU_E2E_CORE_PORT` and
`GEWU_E2E_WEB_PORT`. The suite verifies Shadow Typing Enter/cursor behavior and
wheel propagation at the Monaco boundary.
