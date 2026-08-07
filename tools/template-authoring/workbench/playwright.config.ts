import { defineConfig } from "playwright/test";

const webPort = process.env.GEWU_E2E_WEB_PORT ?? "5183";

export default defineConfig({
  testDir: "./tests",
  globalSetup: process.env.GEWU_E2E_EXISTING ? undefined : "./tests/global-setup.ts",
  workers: 1,
  fullyParallel: false,
  timeout: 45_000,
  expect: { timeout: 12_000 },
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    headless: true,
    permissions: ["clipboard-read", "clipboard-write"],
    trace: "retain-on-failure",
  },
});
