import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    outDir: "dist/client",
  },
  server: {
    port: 3400,
    proxy: {
      "/api": {
        target: "http://localhost:3401",
        changeOrigin: true,
      },
    },
  },
});
