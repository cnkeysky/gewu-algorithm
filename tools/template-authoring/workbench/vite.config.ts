import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: {
      "/api": "http://127.0.0.1:4174",
      "/core": { target: "http://127.0.0.1:4175", rewrite: (path) => path.replace(/^\/core/, "") },
    },
  },
});
