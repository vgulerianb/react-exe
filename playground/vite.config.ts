import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Dev playground: resolves `react-exe` to the library source so changes hot-reload.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: {
      "react-exe": fileURLToPath(new URL("../src/index.tsx", import.meta.url)),
    },
  },
  server: { port: 5199 },
});
