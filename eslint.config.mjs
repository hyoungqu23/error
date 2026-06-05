// eslint.config.mjs — 워크스페이스 가드레일 (RFC §8, P7).
// 타입체크는 tsc(turbo typecheck)가 담당한다 — 여기는 벤더 격리/위험 구문의 경계 가드만
// (타입 정보 미사용 룰 → 빠른 lint).
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // P8 편입 예정(이연 지점):
    //  - apps/**            — 도그푸딩 마이그레이션과 함께 lint 활성화. 그때 컴포지션 루트
    //                         (composition-root.ts / instrumentation* / Toaster 마운트 지점)에
    //                         벤더 import 허용 오버라이드를 추가한다.
    //  - error-decision-system — P8에서 패키지 은퇴.
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/.turbo/**",
      "apps/**",
      "packages/error-decision-system/**",
    ],
  },
  {
    // 가드 스코프는 packages/*/src/** — "출하 코드는 전부 src/ 아래"가 이 워크스페이스의 불변이다.
    files: ["packages/*/src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // RFC §8-1: 벤더 SDK는 어댑터(error-adapters)만 import한다 — feature/app 코드 금지.
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "sonner",
              message:
                "벤더 toast SDK는 error-adapters(createSonnerPresenter)만 import합니다 — UI는 Presenter/ErrorFallback 경유 (RFC §8).",
            },
          ],
          patterns: [
            {
              group: ["@sentry/*"],
              message:
                "Sentry SDK는 error-adapters(createSentryReporter/sentryBeforeSend)만 import합니다 — 보고는 handleError 단일 경로 경유 (RFC §8).",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.object.name='Sentry'][callee.property.name='captureException']",
          message:
            "Sentry.captureException 직접 호출 금지 — handleError(단일 처리 경로)를 거쳐 ReporterSink가 보고합니다 (RFC §8).",
        },
        {
          selector:
            "JSXExpressionContainer > MemberExpression[object.name=/^(e|err|error)$/][property.name='message']",
          message:
            "error.message 직접 렌더 금지 — resolveErrorMessage(messageKey)로 해소된 카피만 렌더합니다(누출게이트 보존, RFC §8).",
        },
        {
          selector: "CallExpression[callee.name='toast'] MemberExpression[property.name='message']",
          message:
            "toast(...) 인자에서 .message 접근 금지(어디서든) — Presenter(createSonnerPresenter)가 user.messageKey를 해소합니다 (RFC §8).",
        },
        // 정적 import만 보는 no-restricted-imports의 사각지대 — 동적 import()/require() 우회 봉쇄.
        {
          selector: "ImportExpression > Literal[value=/^(sonner|@sentry\\u002F)/]",
          message:
            "벤더 SDK 동적 import() 금지 — sonner/@sentry는 error-adapters만 import합니다 (RFC §8).",
        },
        {
          selector: "CallExpression[callee.name='require'] > Literal[value=/^(sonner|@sentry\\u002F)/]",
          message:
            "벤더 SDK require() 금지 — sonner/@sentry는 error-adapters만 import합니다 (RFC §8).",
        },
      ],
    },
  },
  {
    // 벤더 어댑터 본체 + 테스트(SDK mock/fixture)는 벤더 룰 제외 — 격리 원칙의 '안쪽'이다.
    files: [
      "packages/error-adapters/src/**/*.{ts,tsx}",
      "packages/*/src/**/__tests__/**/*.{ts,tsx}",
      "packages/*/src/**/*.test.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": "off",
      "no-restricted-syntax": "off",
    },
  },
);
