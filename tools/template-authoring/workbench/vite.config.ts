import { defineConfig } from "vite";

const authoringTarget = process.env.GEWU_AUTHORING_TARGET ?? `http://127.0.0.1:${process.env.GEWU_AUTHORING_PORT ?? "4174"}`;
const coreTarget = process.env.GEWU_CORE_TARGET ?? `http://127.0.0.1:${process.env.GEWU_CORE_PORT ?? "4175"}`;

export default defineConfig({
  server: {
    strictPort: true,
    // WSL2 and editor atomic-save workflows can miss inotify events, which
    // leaves the browser tab on stale modules (symptoms: the shadow editor
    // rejects Enter, old layout keeps rendering). Polling keeps dev changes
    // visible immediately at a small CPU cost.
    watch: { usePolling: true, interval: 200 },
    proxy: {
      "/api": authoringTarget,
      "/core": { target: coreTarget, rewrite: (path) => path.replace(/^\/core/, "") },
    },
  },
});
