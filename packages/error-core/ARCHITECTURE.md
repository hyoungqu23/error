# `core/error/` 파일 가이드

이 디렉터리는 통합 에러 시스템의 구현체다(설계 문서: `error-design.md` / `error-design-kr.md`, 정합성: `tsc --noEmit` 0 · `vitest` 324/0).

> **먼저 — 파일이 38개라 많아 보이지만, 소비자가 보는 공개 표면은 단 2개다.**
> - 클라이언트/기능 코드 → `import { … } from "@/error"` (`index.ts`)
> - 서버 코드(Server Action·Route Handler·RSC DAL) → `import { … } from "@/error/server"` (`server.ts`)
>
> 나머지 36개는 **내부 구현**이다. 직접 import할 일은 거의 없다. 파일 수는 "공개 API의 복잡도"가 아니라 "내부 책임 분리의 세분도"다.

분리 원칙은 세 가지뿐이다:
1. **의존성 리프(leaf) 격리** — `severity`/`policy`/`runtime`/`registry`처럼 의존이 0이거나 최소인 파일을 따로 둬서, 누구나 사이클 없이 import하게 한다(설계 단계에서 `app-error ↔ make-error ↔ normalize` 순환을 끊은 핵심).
2. **벤더 격리(DI 경계)** — "벤더 X를 아는 파일은 정확히 하나"(Sentry/sonner/pager/console). 기능 코드는 `@sentry/*`를 절대 import하지 않는다.
3. **경계별 단일 책임(SRP)** — server action / form action / route handler / network / 이벤트 핸들러 / 브라우저 / 인터럽트는 진짜로 다른 진입 표면이다.

의존 방향(단방향, 위→아래): **vocabulary 리프 → registry/model → telemetry 계약 → processor → adapters → boundaries → entrypoints → barrels**.

---

## 0. 어휘 리프 — 의존 0, 일부러 작게 유지

| 파일 | LOC | 책임 | 주요 export |
|---|---|---|---|
| `severity.ts` | 2 | 심각도 어휘 | `Severity` |
| `policy.ts` | 15 | 정책 어휘 (전달/로그/HTTP/종류) | `PresentAction`, `LogLevel`, `HttpStatus`, `ErrorKind` |
| `runtime.ts` | 3 | 서버/클라 런타임 판별(Edge 안전, 호출시점 평가) | `Runtime`, `getRuntime` |

> **왜 분리?** 이 셋은 의존이 0이라 *모든* 파일이 사이클 없이 import할 수 있다. `registry.ts`가 zod·app-error를 끌어오지 않고 타입만 가져오게 하는 핵심 받침대.

## 1. 레지스트리(SSOT) + 스키마

| 파일 | LOC | 책임 | 주요 export | 의존 |
|---|---|---|---|---|
| `registry.ts` | 56 | **단일 진실 공급원**. 코드별 정책(`kind`/`present`/`log`/`severity`/`httpStatus`/`retryable`/`userMessageKey`). bare `ERROR_REGISTRY` 비공개, `DEFAULT`만 export | `ErrorMeta`, `DEFAULT_ERROR_REGISTRY`, `ErrorRegistry`, `ErrorCode` | `./severity`, `./policy` |
| `schema.ts` | 23 | 코드별 `details` 모양(zod). 컴파일·런타임 검증의 원천 | `ErrorDetailsSchema`, `ErrorDetailsMap` | `./registry` |
| `active-registry.ts` | 92 | **바인딩** — getter와 `handleError`가 읽는 단일 권위. 클라 싱글턴 + 서버 요청별 `AsyncLocalStorage`. dev warn-once | `getActiveErrorRegistry`, `setActiveErrorRegistry`, `runWithErrorRegistry` | `./registry`, `./runtime` |

## 2. 에러 모델

| 파일 | LOC | 책임 | 주요 export | 의존 |
|---|---|---|---|---|
| `app-error.ts` | 218 | 핵심. `DomainError` 클래스(getter는 활성 레지스트리 읽음), `resolvePolicy`, 타입가드, 재수화 진입 | `DomainError`, `resolvePolicy`, `ResolvedAppError`, `SerializedError`, `isDomainError`, `isSerializedError`, `isExpectedCode` | `./registry`, `./active-registry`, `./schema`, `./runtime`, `./severity`, `./policy` |
| `make-error.ts` | 30 | 단일 생성 경로(검증 + UNKNOWN_* 폴백) | `makeError`, `unknownCodeForRuntime` | `./schema`, `./app-error`, `./runtime`, `./registry` |
| `normalize.ts` | 89 | 처리 경로 1단계 — 경계 넘은 plain object → `DomainError` 재수화(4분기) | `normalizeToDomainError` | `./app-error`, `./make-error`, `./registry` |
| `serialize-client.ts` | 104 | **누출 방지 강제 지점**. 클라 전송 시 free-text message 제거 + `details` 허용목록 게이팅 | `toClientSerialized`, `DETAILS_ALLOWLIST`, `gateClientDetails` | `./registry`, `./schema`, `./app-error` |
| `result.ts` | 9 | 직렬화 안전 `Result` 계약(뮤테이션 트랙) | `Result`, `Success`, `Failure`, `actionSuccess`, `actionFailure` | `./app-error`, `./serialize-client` |

## 3. 텔레메트리 계약 + 프로세서

| 파일 | LOC | 책임 | 주요 export | 의존 |
|---|---|---|---|---|
| `telemetry.ts` | 33 | 싱크 인터페이스 — `Reporter`(모니터링)·`Presenter`(UX)·컨텍스트 | `TelemetryContext`, `Reporter`, `Presenter` | `./app-error`, `./policy` |
| `notifier.ts` | 80 | 세 번째 싱크(알림) + 심각도 게이트 정책 | `Notifier`, `AlertPolicy`, `thresholdAlertPolicy`, `compositeNotifier`, `policyGatedNotifier`, `noopNotifier` | `./severity`, `./app-error`, `./telemetry` |
| `translator.ts` | 107 | i18n — `userMessageKey` → 카피. 라이브러리 무관 seam + 코드별 폴백 맵 + never-throw 리졸버 | `Translator`, `FALLBACK_MESSAGES`, `resolveErrorMessage`, `createFallbackTranslator` | `./registry` |
| `types.ts` | 16 | 주입 deps 묶음 | `HandleErrorDeps` | `./registry`, `./telemetry`, `./notifier` |
| `handle-error.ts` | 49 | **단일 처리 경로(유일한 불순 함수)** — 정규화 → 정책 해소 → report/notify/present/breadcrumb | `createHandleError`, `HandleErrorOptions` | `./app-error`, `./normalize`, `./types`, `./telemetry`, `./policy`, `./severity` |

## 4. 벤더 어댑터 — "벤더를 아는 파일은 각각 하나"

| 파일 | LOC | 책임 | 주요 export |
|---|---|---|---|
| `adapters/sentry-reporter.ts` | 205 | **유일하게** `@sentry/*`를 import. beforeSend PII 스크럽 + fingerprint + 토큰버킷 throttle + breadcrumb | `createSentryReporter`, `sentryBeforeSend` |
| `adapters/console-reporter.ts` | 48 | 구조화 서버/dev 로그 싱크(SDK 없음) | `createConsoleReporter` |
| `adapters/composite.ts` | 106 | 가드된 컴포지트 팬아웃 + **dead-man's-switch**(삼켜진 실패 카운터/health) | `guardedCompositeReporter`, `compositeReporter`, `noopReporter` |
| `adapters/pager-notifier.ts` | 119 | **유일하게** 페이저 벤더를 앎(웹훅, 교체 가능). 타임아웃 + dedupKey 억제 | `createPagerNotifier`, `webhookPagerTransport` |
| `adapters/sonner-presenter.ts` | 43 | **유일하게** `sonner`를 import. 카피 해석 + toast id 디듀프 | `createSonnerPresenter` |

## 5. 경계(boundary) — 변환/처리 진입 표면

| 파일 | LOC | 책임 | 주요 export | 비고 |
|---|---|---|---|---|
| `next-control-flow.ts` | 41 | 프레임워크 제어흐름(redirect/notFound/forbidden/unauthorized) 식별·재throw | `isRedirectError`, `rethrowControlFlow` … | 의존 0 |
| `network-boundary.ts` | 154 | **네트워크 경계(변환, throwing)** — 쿼리 트랙 진입점, 8개 코드의 유일 생산자, outbound correlationId | `networkBoundary`, `NetworkBoundaryOptions` | client+server |
| `safe-server-action.ts` | 42 | RPC형 뮤테이션 경계(Result 트랙) | `safeServerAction` | server-only |
| `safe-form-action.ts` | 59 | 폼 뮤테이션 경계, `useActionState` 호환 `(prevState, formData)` | `safeFormAction`, `FormState` | server-only |
| `raise.ts` | 30 | 쿼리의 expected 에러 → Next 인터럽트 다리 | `raise` | server-only |
| `route-handler.ts` | 17 | `AppError` → HTTP 응답(`httpStatus` + correlationId) | `toErrorResponse` | |
| `safe-handler.ts` | 15 | 인터랙션 경계(이벤트 핸들러 try/catch) | `safeHandler` | client |
| `browser-boundary.ts` | 22 | 브라우저 경계 — `window.onerror`/`onunhandledrejection` 최후 안전망 | `initBrowserBoundary` | client |

## 6. 재시도 헬퍼

| 파일 | LOC | 책임 | 주요 export |
|---|---|---|---|
| `retry-after.ts` | 29 | `Retry-After` 파싱 + "언제 재시도?" 오라클(순수, client+server) | `parseRetryAfter`, `retryAfterHintFromError` |
| `backoff.ts` | 35 | 지수 백오프 + 지터 지연 정책(순수) | `computeRetryDelay`, `exponentialBackoffWithJitter`, `DEFAULT_BACKOFF` |
| `with-retry.ts` | 83 | 서버측 재시도(`retryable` 플래그 + Retry-After 존중) | `withRetry` |
| `query-client.ts` | 43 | TanStack QueryClient 기본 — `retryable` 배선(404 무재시도 수정) | `makeQueryClient`, `shouldRetryQuery` |

## 7. 런타임 진입점 + DI 루트

| 파일 | LOC | 책임 | 주요 export | 비고 |
|---|---|---|---|---|
| `handler.ts` | 34 | **클라 싱글턴** — `initHandleError`로 1회 배선, 전역 `handleError` | `initHandleError`, `handleError`, `setErrorUser` | client |
| `request-handler.server.ts` | 131 | **서버 컴포지션 루트** + 요청별 핸들러(React `cache()`), serverDeps, health용 `serverReporter` | `getRequestHandler`, `serverDeps`, `serverReporter`, `getRequestCorrelationId` | server-only |
| `use-error-handler.ts` | 61 | `useErrorHandler` 훅 — `page` 에스컬레이션 + redirect returnTo | `useErrorHandler` | client |
| `registry-context.tsx` | 13 | (희소) 레지스트리 읽기용 React context | `ErrorRegistryProvider`, `useErrorRegistry` | client |
| `field-errors.ts` | 20 | 쿼리 트랙 VALIDATION 인라인 분기 헬퍼 | `fieldErrorsFromError` | |

## 8. 공개 배럴 — 소비자가 실제로 import하는 2개

| 파일 | LOC | 책임 |
|---|---|---|
| `index.ts` | 23 | **클라이언트 안전** 공개 표면(makeError, Result, useErrorHandler, resolveErrorMessage, isDomainError, makeQueryClient, fieldErrorsFromError …) |
| `server.ts` | 25 | **서버 전용** 공개 표면(safeServerAction, safeFormAction, raise, getRequestHandler, toErrorResponse) — `import "server-only"` |

---

## "근데 너무 잘게 나눈 거 아니야?" — 솔직한 평가

**대체로 정당하다.** 38개처럼 보이지만 (a) 공개 표면은 배럴 2개뿐이고, (b) ~8계층으로 단방향 정렬돼 있으며, (c) 대부분의 분리는 *목적이 있다*:
- **어휘 리프**(severity/policy/runtime) = 사이클 차단용. 합치면 `registry`의 리프 순수성이 흐려진다.
- **벤더 어댑터 5개** = DI 격리의 본질. "Sentry를 아는 파일은 하나"라는 규칙이 곧 교체 가능성·테스트 용이성.
- **경계 8개** = 서로 다른 진입 표면(SRP). 합치면 잡동사니 파일이 된다.
- 참고로 설계 원안은 *더* 잘게 쪼개져 있었고(`i18n/` 서브폴더, `server/` 서브폴더, `alert-policy.ts`), 구체화하면서 이미 한 차례 **통합**했다(`error-design.md` §12.3 참조). 지금이 그 통합본이다.

**합치고 싶다면 — 아키텍처 손해 없이 ~3~5개 줄일 후보** (취향 영역):
- `retry-after.ts` + `backoff.ts` → `retry-delay.ts` (둘 다 순수 지연 로직, 합쳐도 무손해)
- `safe-server-action.ts` + `safe-form-action.ts` → `safe-actions.ts` (가까운 자매)
- `severity.ts` + `policy.ts` + `runtime.ts` → `primitives.ts` (단, registry 리프 순수성이 약간 흐려짐 — 트레이드오프)
- `field-errors.ts`(20줄)는 `result.ts`나 `index.ts`에 흡수 가능

**합치면 안 되는 것**: app-error / make-error / normalize / serialize-client(순환 회피 + 누출 경계), 벤더 어댑터(DI 격리), handle-error(유일한 불순 셸).

> 결론: 파일 수가 많은 게 *복잡도*는 아니다 — 공개 표면 2개, 단방향 8계층, 명시적 책임. 다만 순수 헬퍼 몇 개는 취향에 따라 합쳐도 무방하다.
