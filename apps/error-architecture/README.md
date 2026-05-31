# error-architecture (Next.js 16 레퍼런스 앱)

`error-core` / `error-adapters` / `error-next` 패키지를 소비해 **통합 에러 시스템**을 실제로 배선·시연하는 Next.js 16(App Router, Turbopack) 앱이다.

## 실행

```bash
pnpm --filter error-architecture-app dev     # 개발 서버
pnpm --filter error-architecture-app build   # 프로덕션 빌드 (Turbopack)
```

또는 루트에서 `pnpm dev` / `pnpm build` (turbo).

## 컴포지션 루트 (DI 경계)

"어떤 어댑터를 쓸지" 결정하는 유일한 장소:

- **클라이언트** — [`lib/composition-root.ts`](lib/composition-root.ts)의 `buildClientDeps()`가 sonner presenter + guarded console reporter를 조립. [`app/error-init.tsx`](app/error-init.tsx)가 `initHandleError`로 1회 바인딩 + `initBrowserBoundary`.
- **서버** — `error-next/server`의 기본 `serverDeps`(Sentry+console reporter, pager notifier, 요청별 correlationId)를 사용.
- **프로바이더** — [`app/providers.tsx`](app/providers.tsx)가 `QueryClientProvider`(`makeQueryClient`) + sonner `<Toaster />` + `ErrorInit`을 마운트.

## 라우트

| 경로 | 시연 |
|---|---|
| `/` | 아키텍처 개요 + 데모 인덱스 |
| `/demo/form-action` | `safeFormAction` + `useActionState`. VALIDATION 인라인 / INVALID_CREDENTIALS Result.Failure |
| `/demo/query-retry` | `networkBoundary` + TanStack. `retryable` 배선(404 무재시도, 429/5xx 재시도) + 토스트 |
| `/demo/boundaries` | `raise()` 인터럽트: NOT_FOUND→404, FORBIDDEN→403, fault→error.tsx |
| `/api/flaky` | networkBoundary의 두 분기를 시연하는 가변 응답 라우트 |
| `/api/health` | 텔레메트리 dead-man's-switch 헬스 프로브(503 escalation) |

데모 자격증명: `demo@aents.co` / `password123`.

## 인프라

- **`proxy.ts`** (Next 16 proxy 컨벤션, Node.js 런타임) — 모든 요청에 `x-request-id`를 심어(또는 well-formed inbound 존중) RSC/DAL/액션이 `headers()`로 읽게 하고, 응답 헤더 + 비-httpOnly 쿠키로 클라이언트까지 전파한다.
- **`next.config.ts`** — `transpilePackages`(raw-TS 패키지 트랜스파일) + `experimental.authInterrupts`(forbidden/unauthorized).
- **에러 바운더리** — `app/error.tsx`(세그먼트), `app/global-error.tsx`(루트, minimal), `app/not-found.tsx` / `app/forbidden.tsx` / `app/unauthorized.tsx`(인터럽트).
