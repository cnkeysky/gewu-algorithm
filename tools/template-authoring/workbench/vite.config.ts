import { defineConfig } from "vite";

const authoringTarget = process.env.GEWU_AUTHORING_TARGET ?? `http://127.0.0.1:${process.env.GEWU_AUTHORING_PORT ?? "4174"}`;
const coreTarget = process.env.GEWU_CORE_TARGET ?? `http://127.0.0.1:${process.env.GEWU_CORE_PORT ?? "4175"}`;

export default defineConfig({
  server: {
    proxy: {
      "/api": authoringTarget,
      "/core": { target: coreTarget, rewrite: (path) => path.replace(/^\/core/, "") },
    },
  },
});
