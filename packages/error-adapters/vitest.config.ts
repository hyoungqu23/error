import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    // Order matters: more specific aliases first.
    alias: [
      { find: /^server-only$/, replacement: r("./test/server-only-stub.ts") },
      // 이 패키지가 소유한 벤더 어댑터.
      { find: /^@\/error\/adapters\/(pager-notifier|sonner-presenter|sentry-reporter)$/, replacement: r("./src/$1") },
      // core가 소유한 순수 어댑터(console/composite).
      { find: /^@\/error\/adapters\/(.*)$/, replacement: "error-core/adapters/$1" },
      // 나머지 core 모듈은 워크스페이스 패키지로 해소.
      { find: /^@\/error\/(.*)$/, replacement: "error-core/$1" },
    ],
  },
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
