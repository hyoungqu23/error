import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// 이 패키지가 소유한 next-internal 모듈(상대 import로 묶여 있어 alias도 ./src로 해소).
const NEXT_INTERNAL =
  /^@\/error\/(next-control-flow|raise|request-handler\.server|safe-server-action|safe-form-action|with-retry|use-error-handler|query-client)$/;

export default defineConfig({
  resolve: {
    // Order matters: more specific aliases first.
    alias: [
      { find: /^server-only$/, replacement: r("./test/server-only-stub.ts") },
      { find: /^@\/components\/(.*)$/, replacement: r("./src/components/$1") },
      // 벤더 어댑터는 error-adapters로.
      { find: /^@\/error\/adapters\/(sentry-reporter|sonner-presenter|pager-notifier)$/, replacement: "error-adapters/$1" },
      // 순수 어댑터(console/composite)는 error-core로.
      { find: /^@\/error\/adapters\/(.*)$/, replacement: "error-core/adapters/$1" },
      // next-internal 모듈은 이 패키지 ./src로. (소스의 상대 import와 동일 파일로 해소되어 vi.mock 매칭됨)
      { find: NEXT_INTERNAL, replacement: r("./src/$1") },
      // 나머지 core 모듈은 워크스페이스 패키지로. (소스의 `error-core/*`와 동일 realpath로 해소되어 vi.mock 매칭됨)
      { find: /^@\/error\/(.*)$/, replacement: "error-core/$1" },
    ],
  },
  test: {
    // .test.tsx는 docblock `// @vitest-environment jsdom`으로 jsdom을 켠다.
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
