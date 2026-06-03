# P5 — error-next un-red (decision 모델 채택) Implementation Plan

> **For agentic workers:** 순차 TDD. error-next는 현재 패키지 전체가 red(P3e가 구 표면 삭제) → 신 decision 표면으로 마이그레이션해 green으로 만든다. 게이트는 **`pnpm --filter error-next typecheck && pnpm --filter error-next test` green** + 그 blocker인 **error-adapters/pager-notifier green**.

**Goal:** P3e에서 삭제된 구 표면(DomainError/registry/active-registry/policy/severity/telemetry/notifier/adapters + `.retryable`/`.userMessageKey`/`actionFailure`/`toErrorResponse`/`HandleErrorDeps.registry`)을 소비하던 `error-next` 13개 소스 + 4개 테스트를 통합 decision 모델(AppError/ReporterSink/NotifierSink/DecisionFailure/degrade/createErrorResponder/CANONICAL_ERROR_SEMANTICS)로 재배선해 `error-next`를 green으로 만든다. error-next가 import하는 `error-adapters/pager-notifier`(유일 blocker)도 NotifierSink로 마이그레이션한다. sentry-reporter/sonner-presenter는 error-next가 의존하지 않으므로 **P6에 남긴다**.

**Architecture (잠긴 결정):**
- **D-P5-1 (DecisionSystem SSOT 위치 = 옵션 1, 사용자 승인 2026-06-04):** `error-next`에 **`src/error-system.ts`** 신설 — baseline `operations` 카탈로그 + `export const errorSystem = createDecisionSystem({ errors: CANONICAL_ERROR_SEMANTICS, operations, fallbackErrorCode: "UNKNOWN_SERVER_ERROR" })`. 서버 root(`request-handler.server`)·클라 root(`ErrorHandlerInit`)가 이를 **내부적으로** 소비. 공개 prop(`ErrorHandlerInit {correlationId}`) 불변 → **host(apps) 영향 0**. 실제 도메인 operations 주입은 P8에서 optional system prop 추가(상위호환)로 확장.
- **D-P5-2 (registry-context.tsx = 삭제):** active-registry 제거로 런타임 registry lookup 불필요. 신 모델은 resolved `decision`/`AppError`가 모든 정보 보유. src 내 실사용 0(index.ts re-export만) → 파일 삭제 + 배럴 export 제거.
- **D-P5-3 (expected 비즈니스 에러 판정):** 구 `isExpectedCode(code)` → `CANONICAL_ERROR_SEMANTICS[code]?.category === "business"` (VALIDATION/INVALID_CREDENTIALS/AUTH_REQUIRED/FORBIDDEN/NOT_FOUND).
- **D-P5-4 (report-free Failure 경로):** safe-* Track1(expected)은 report 없이 wire payload만 → `degrade(handleServerError(error, { telemetry: { capture:false, breadcrumb:false, alert:false } }))`. handleServerError 반환을 `DecisionFailure`로 바꾼다(handle-error.ts createHandleError가 이미 DecisionFailure 반환).
- **D-P5-5 (retry 판정):** 구 `DomainError.retryable` getter → `CANONICAL_ERROR_SEMANTICS[code]?.defaultRetryable ?? false`. retry-after 힌트는 신 `retryAfterHintFromError`(error-core).

**신 표면 매핑(요약):** `error-core/app-error`→배럴(AppError/appError/isAppError/isClientErrorPayload/SerializedError); `error-core/registry`→ErrorCode(배럴)+CANONICAL_ERROR_SEMANTICS; `error-core/policy|severity|active-registry|telemetry(Reporter/Presenter)|notifier(Notifier)|adapters/*`→삭제; ReporterSink/NotifierSink/TelemetryContext/DecisionFailure/HandleErrorOptions/HandleErrorDeps→배럴; `result.actionFailure`→`degrade`; `route-handler.toErrorResponse`→`createErrorResponder(system)`; `.userMessageKey`→`messageKey`/catalog `defaultMessageKey`; `HandleErrorOptions.present/log`→`telemetry?:Partial<TelemetryDecision>`.

**게이트:** P5는 **패키지 통째 red→green** 마이그레이션이라 P3e식 파일별 green 유지가 불가능하다. 의존 순서로 진행하며 typecheck 에러 수가 단조 감소하는지 확인하고, **최종에 `error-next` typecheck+test green + `error-adapters` pager-notifier green**을 달성한다. 커밋은 green 달성 후 논리 그룹으로 분할(중간 WIP 커밋은 br\anch 내부라 허용). sentry/sonner(P6)는 red 유지 정상.

---

## Task 분해 (의존 순서)

### T1: `error-adapters/pager-notifier.ts` (+test) → NotifierSink
- pager-notifier.ts: `Notifier.notify(error,severity,ctx)` → `NotifierSink.alert(error: AppError, decision: TelemetryDecision, ctx: TelemetryContext)`. `Severity`→`TelemetryDecision["level"]`. import 4개(notifier/app-error/severity/telemetry)→배럴 `{ type NotifierSink, type TelemetryDecision, type TelemetryContext, type AppError }`. `createPagerNotifier`/`webhookPagerTransport`/`PageEvent`/`PagerTransport` 이름·arity 보존. PageEvent.severity 필드는 wire 모양 유지(타입만 level).
- pager-notifier.test.ts: `@/error/telemetry`→`@/error`. `notify(e,"fatal",ctx)`→`alert(e, fatalDecision, ctx)`(TelemetryDecision 헬퍼). ctxFor에 `operation` 추가(TelemetryContext = RuntimeContext & {operation}).
- **게이트:** `pnpm --filter error-adapters test` 에서 pager-notifier green(sentry/sonner red 허용).

### T2: `error-next/src/error-system.ts` 신설 (D-P5-1)
- baseline `operations` 카탈로그(최소: `unknown` — owner/criticality/defaultUiScope/piiRisk) + `errorSystem = createDecisionSystem({ errors: CANONICAL_ERROR_SEMANTICS, operations, fallbackErrorCode: "UNKNOWN_SERVER_ERROR" })`. client-safe(순수 데이터, server-only/next 미import). 서버는 추가로 `defaultRuntime:"server"`가 필요하면 별도 server system 또는 finalize 시 runtime arg로 처리(runtime은 finalize 인자로 주입 가능 → 단일 system 공유 가능).

### T3: `request-handler.server.ts` (서버 composition root)
- import 정리(active-registry/registry/telemetry/notifier/adapters 삭제). `errorSystem`(T2) import. `HandleErrorDeps={system,reporter,notifier}`(registry/presenter 제거). serverPresenter 삭제. `buildServerNotifier`→NotifierSink(pager 연결 T1 완료 후). serverReporter→인라인 ReporterSink({capture,breadcrumb}); health()는 P8 health route 의존 — 임시 stub 또는 P8까지 RED 수용(주석 명시). `createHandleError(errorSystem, {reporter,notifier}, ctx, baseOccurrence)` 4-인자. ctx에 `operation` 필수. `HandleServerError` 반환 `ResolvedAppError`→`DecisionFailure`. runWithErrorRegistry 래핑 제거. `createErrorResponder(errorSystem)` 바인딩 export 추가(server.ts용).

### T4: `safe-server-action.ts` / `safe-form-action.ts`
- `isDomainError`→`isAppError`, `isExpectedCode`→category==="business"(D-P5-3). `actionFailure`→`degrade`(D-P5-4). VALIDATION 실패: `degrade(handleServerError(makeError({code:"VALIDATION",details:{fieldErrors}}), {telemetry:{capture:false,breadcrumb:false,alert:false}}))`. Track1: `if (isAppError(error) && CANONICAL_ERROR_SEMANTICS[error.code]?.category==="business") return degrade(handleServerError(error,{telemetry:{...false}}))`. Track2: `handleServerError(error)`(present 제거) + throw. rethrowControlFlow 유지. FormState<R>=Result<R>|null 불변.

### T5: `server.ts` (server-only 배럴)
- `export { toErrorResponse } from "error-core/route-handler"` 삭제 → request-handler가 export하는 바인딩된 `errorResponder` 재노출(또는 `createErrorResponder` 팩토리 재노출). 나머지 재노출(safe*/raise/withRetry/getRequestHandler/serverDeps/serverReporter/HandleServerError) 유지(소스 green 전제).

### T6: query/retry 그룹 — `raise.ts`, `query-client.ts`, `with-retry.ts`, `next-control-flow.ts`
- raise.ts: `DomainError`→`AppError`(타입 스왑), switch 본문 불변. case 코드명(NOT_FOUND/AUTH_REQUIRED/FORBIDDEN) 카탈로그 일치 확인.
- query-client.ts: `isDomainError`→`isAppError`, `.retryable`→`CANONICAL_ERROR_SEMANTICS[code]?.defaultRetryable ?? false`(D-P5-5). catch unknown→isAppError narrow.
- with-retry.ts: 동일. 인라인 retryAfterHintFromError는 isDomainError→isAppError(또는 error-core 신 import).
- next-control-flow.ts: **변경 없음**(error-core 무의존).

### T7: 클라 — `use-error-handler.ts`, `ErrorHandlerInit.tsx`, `registry-context.tsx`(삭제), `components/ErrorFallback.tsx`, `index.ts`
- use-error-handler.ts: ResolvedAppError→DecisionFailure. `.policy.present`→`.decision.user.surface`, `.code`→`.error.code`. PresentAction import 삭제. ErrorCode 출처 배럴.
- ErrorHandlerInit.tsx: import 정리. `initHandleError(buildClientDeps(errorSystem), {correlationId})`(신 시그니처). 인라인 noop ReporterSink/NotifierSink. presenter 삭제. prop `{correlationId}` 불변(D-P5-1).
- registry-context.tsx: **삭제**(D-P5-2) + index.ts에서 `ErrorRegistryProvider/useErrorRegistry` export 제거.
- ErrorFallback.tsx: `isDomainError`→`isAppError`. `userMessageKey`→`CANONICAL_ERROR_SEMANTICS[code]?.defaultMessageKey ?? "error.unknown"`. `retryable`→catalog defaultRetryable. `{log:"none"}`→`{telemetry:{capture:false,breadcrumb:false,alert:false}}`. isAppError 가드 후 .code 접근.
- index.ts: registry-context export 제거, 나머지 표면 점검.

### T8: 테스트 4개
- query-retry.test.ts: DomainError import→AppError/isAppError. `.retryable`→catalog 조회. `toBeInstanceOf(DomainError)`→`isAppError(...)`.
- safe-form-action.test.ts: `{present:"silent"}` 단정→소스의 신 보고 호출(telemetry). `result.error.userMessageKey`→`.messageKey`. expected/unexpected 분기는 category 기반.
- error-fallback.test.tsx: `{log:"none"}`→신 telemetry 단정.
- error-fallback-g11.test.tsx: active-registry/registry import+setActiveErrorRegistry 삭제. (d) retry 가시성은 catalog defaultRetryable 의존.

---

## Self-Review
- **Spec coverage:** 18 카드(13 error-next src + 4 test + pager src/test) 전부 Task에 매핑. next-control-flow는 무변경(확인만).
- **HandleErrorSystem variance(handoff 노트):** createHandleError가 `HandleErrorSystem=Pick<DecisionSystem<base>,...>`를 받는다. `errorSystem`(구체 카탈로그)을 넘길 때 finalizeUnknown의 occurrence param contravariance가 문제되면 → HandleErrorSystem을 generic화하거나 호출부 캐스트. **T3에서 typecheck로 확정.**
- **operation 필수:** TelemetryContext/OccurrenceContext가 operation 요구 → baseline operations "unknown" + ctx/occurrence에 operation 채움.
- **누출게이트 불변:** safe-*는 `degrade`(payload만)·createErrorResponder만 wire로 — toClientErrorPayload 단일 게이트 유지(변경 없음).
- **host 영향:** 옵션 1로 공개 prop 불변 → apps(P8) 무영향. registry-context 삭제만 외부 표면 축소(host 미사용 가정, P8에서 확인).
