import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    // Tests keep the historical `@/error/*` alias; every core module lives in ./src.
    alias: [{ find: /^@\/error\/(.*)$/, replacement: r("./src/$1") }],
  },
  test: {
    // .test.tsx opt into jsdom via a `// @vitest-environment jsdom` docblock (none in core).
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
