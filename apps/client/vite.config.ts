import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { PORTS } from "../../packages/shared/src/config.js";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: PORTS.client,
    proxy: {
      "/game": `http://localhost:${PORTS.server}`,
      "/health": `http://localhost:${PORTS.server}`,
    },
  },
});
