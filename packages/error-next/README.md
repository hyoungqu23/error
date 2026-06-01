# error-next

**Next.js(App Router) + React 통합 계층.** [`error-core`](../error-core)의 커널과 [`error-adapters`](../error-adapters)의 벤더 어댑터를 묶어, 실제 진입 표면(경계)을 제공한다.

공개 표면은 2개:

- **클라이언트 배럴** — `import { … } from "error-next"`. `error-core`의 클라이언트 안전 표면을 전량 재노출(`export * from "error-core"`)하고, React/Next 전용 진입점을 더한다.
- **서버 전용 배럴** — `import { … } from "error-next/server"`. `"server-only"` 가드가 잘못된 클라이언트 import를 **빌드 에러**로 만든다.

## 표면

### `error-next` (클라이언트)
- `useErrorHandler` — 인터랙션 경계 훅(redirect/page 에스컬레이션 + returnTo).
- `makeQueryClient` / `shouldRetryQuery` — TanStack QueryClient 기본(`retryable` 배선).
- `ErrorFallback` — 공유 렌더링 경계 UI(`unstable_retry` ?? `reset` ?? reload).
- `ErrorHandlerInit` — 클라 싱글턴 sink 부트스트랩(no-op deps 기본).
- `ErrorRegistryProvider` / `useErrorRegistry`.
- (+ `error-core`의 `makeError`, `Result`, `resolveErrorMessage`, `handleError`, `isDomainError`, `fieldErrorsFromError` …)

### `error-next/server` (서버 전용)
- `safeServerAction` / `safeFormAction` — 뮤테이션/폼 경계(Track-1 Result / Track-2 report+rethrow).
- `raise` — 쿼리 expected 에러 → Next 인터럽트(notFound/redirect/forbidden).
- `getRequestHandler` / `getRequestCorrelationId` / `serverDeps` / `serverReporter` — 요청별 컴포지션 루트.
- `toErrorResponse` — AppError → HTTP 응답.
- `withRetry` — 서버측 재시도.

## peerDependencies

```jsonc
{
  "next": ">=15.1.0",            // App Router · unstable_rethrow · authInterrupts
  "react": ">=19.0.0",
  "react-dom": ">=19.0.0",
  "@tanstack/react-query": "^5.0.0",
  "@sentry/nextjs": "^8.0.0"     // optional — Sentry reporter를 직접 조립할 때만 필요
}
```

> 기본 `serverDeps`는 optional peer인 Sentry를 eager import하지 않는다. 기본 서버 reporter는 guarded console이며, Sentry를 쓰려면 앱의 컴포지션 루트에서 `error-adapters/sentry-reporter`를 명시적으로 조립하고 `Sentry.init({ beforeSend: sentryBeforeSend, ... })`를 배선한다.

## 테스트

```bash
pnpm --filter error-next test   # 37 tests (server 모듈은 vi.mock, 컴포넌트는 jsdom)
```
