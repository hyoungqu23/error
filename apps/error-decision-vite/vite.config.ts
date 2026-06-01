import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 3012,
  },
  build: {
    rollupOptions: {
      // The shared package ships a "use client" entry for RSC consumers (Next). Vite has no
      // RSC, so Rollup strips the directive and warns — silence that one benign warning.
      onwarn(warning, warn) {
        if (warning.code === "MODULE_LEVEL_DIRECTIVE" && warning.message.includes("use client")) {
          return;
        }
        warn(warning);
      },
    },
  },
});
