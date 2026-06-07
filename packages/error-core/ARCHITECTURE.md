# `error-core` 파일 가이드 — 결정(decision) 모델

통합 에러 시스템의 커널 구현체다(설계: [`docs/superpowers/specs/2026-06-02-error-system-convergence-design.md`](../../docs/superpowers/specs/2026-06-02-error-system-convergence-design.md), 정합성: `tsc --noEmit` 0 · vitest 334/0). 구 레지스트리 스택(DomainError 정책 getter · active-registry ALS · zod schema · Reporter/Presenter/Notifier)은 수렴(P0–P8)에서 **결정 모델**로 대체·삭제됐다.

> 공개 표면은 배럴 1개다 — `import { … } from "error-core"`. 세부 모듈 deep import(`error-core/decision/app-error`, `error-core/translator` …)도 가능하다.

핵심 개념은 세 가지다:

1. **카탈로그가 SSOT** — `decision/catalog.ts`의 `CANONICAL_ERROR_SEMANTICS`(15코드 × `ErrorSemantics`: category/sensitivity/defaultHttpStatus/defaultRetryable/messageKeys/detailsExposure/validateDetails). 런타임 활성-레지스트리는 없다 — 정책은 `createDecisionSystem`으로 만든 **주입된 DecisionSystem**이 전부 소유한다.
2. **결정은 occurrence 컨텍스트의 함수** — `resolveErrorDecision({error, semantics, occurrence, runtime})` → `{ user: UserErrorDecision, telemetry: TelemetryDecision }`. 같은 코드라도 어디서 났는지(uiScope/interaction/criticality/idempotent)에 따라 surface/disclosure/action/telemetry가 달라진다.
3. **단일 누출게이트** — 서버→클라 wire는 `toClientErrorPayload`(detailsExposure `allowlist` shallow-pick, `message` 미전송, disclosure 반영 messageKey)뿐이다. `Result`의 `degrade()`가 in-process `DecisionFailure`를 이 payload로 강등한다.

## `decision/` — 결정 엔진

| 파일 | 책임 | 주요 export |
|---|---|---|
| `types.ts` | 결정 어휘(순수 타입) + 3-sink 계약 | `ErrorSemantics`/`OccurrenceContext`/`ErrorDecision`/`ClientErrorPayload`/`ReporterSink`/`NotifierSink`/`Presenter` |
| `catalog.ts` | **SSOT** — 15코드 통합 카탈로그 | `CANONICAL_ERROR_SEMANTICS` |
| `codes.ts` | 코드 어휘(카탈로그 파생, frozen set) | `ErrorCode`, `KNOWN_ERROR_CODES`, `isKnownErrorCode` |
| `app-error.ts` | 순수-데이터 에러 클래스(정책 getter 없음) + wire 가드 | `AppError`, `appError`, `isAppError`, `isSerializedError`, `isClientErrorPayload` |
| `resolve.ts` | 순수 결정 resolver(disclosure/surface/action/telemetry) | `resolveErrorDecision` |
| `validate.ts` | 카탈로그 init-time 불변식(disclosure↔messageKey) | `validateCatalog` |
| `system.ts` | `createDecisionSystem` 팩토리 — finalize\*(D1 validateDetails 게이트)·**toClientErrorPayload(누출게이트)**·executeErrorDecision(텔레메트리 실행)·**옵셔널 `normalizeUnknown` 주입점**(non-AppError를 known 코드로 승격; null→해당 시스템 fallbackErrorCode; promoter throw 시 null 취급 — R2). 주입되는 promoter는 **Error 인스턴스 전용**으로 좁혀 wire(plain object) 재수화는 파이프라인 raw catch에서 차단한다(크로스 모델 P1) | `createDecisionSystem`, `DecisionSystem`, `DecisionFailure`, `fail`, `ok` |

**3-sink 계약**: `ReporterSink`(capture/breadcrumb)·`NotifierSink`(alert)는 `executeErrorDecision`이 `TelemetryDecision`대로 호출한다. **`Presenter`(present)는 파이프라인이 호출하지 않는다** — caller가 반환받은 `decision.user`를 넘기는 소비자 계약이다(presentation은 UI의 몫).

## 루트 — 진입/경계/헬퍼

| 파일 | 책임 | 주요 export |
|---|---|---|
| `make-error.ts` | 단일 생성 경로(catalog validateDetails + UNKNOWN_\* 폴백) | `makeError` |
| `normalize.ts` | 경계 넘은 unknown → `AppError` 재수화. `tryNormalizeKnownError`는 UNKNOWN_\* 폴백 없이 known 코드만 승격하고 미인식 시 null 반환 — Error는 `mapKnownError`(구조 신호만: AbortError→REQUEST_ABORTED, TypeError+알려진 fetch 실패 문구→NETWORK_ERROR/OFFLINE, name `TimeoutError`/code `ETIMEDOUT`→TIMEOUT)로만 매핑하고 wire 덕타이핑(3/3b)은 `!(input instanceof Error)`로 가드해 실제 Error가 wire로 오인되지 않게 못 박는다. plain wire 객체는 그대로 재수화. `normalizeToAppError`와 system `normalizeUnknown`(Error-only 래퍼) 주입이 공유 | `normalizeToAppError`, `tryNormalizeKnownError` |
| `result.ts` | wire `Result` 계약 + **degrade**(DecisionFailure→payload) | `Result`, `actionSuccess`, `degrade` |
| `handle-error.ts` | 단일 처리 경로 — finalizeUnknown + executeErrorDecision 위임 | `createHandleError`, `HandleErrorOptions` |
| `handler.ts` | 클라 싱글턴(`initHandleError` 1회 배선) | `initHandleError`, `handleError`, `setErrorUser` |
| `types.ts` | 주입 deps 묶음 | `HandleErrorDeps` (= system + ReporterSink + NotifierSink) |
| `translator.ts` | i18n — messageKey → 카피(never-throw, key-echo 거부, `{token}` 보간) | `resolveErrorMessage`, `FALLBACK_MESSAGES` |
| `network-boundary.ts` | 네트워크 경계(throwing 변환, 8개 transport 코드의 1차 생산자, zod 스키마 검증). 경계를 우회한 raw catch는 system `normalizeUnknown`(=`tryNormalizeKnownError`)이 같은 transport 코드 일부로 복구 승격 | `networkBoundary` |
| `route-handler.ts` | 캐치값 → HTTP Response(payload + catalog defaultHttpStatus) | `createErrorResponder` |
| `retry-after.ts` / `backoff.ts` | 순수 재시도 오라클(인스턴스-우선 Retry-After 힌트 / 지터 백오프) | `retryAfterHintFromError`, `computeRetryDelay` |
| `field-errors.ts` | VALIDATION per-field 맵 추출 | `fieldErrorsFromError` |
| `safe-handler.ts` / `browser-boundary.ts` | 이벤트 핸들러 try-catch / window 최후 안전망 | `safeHandler`, `initBrowserBoundary` |
| `runtime.ts` | 서버/클라 판별(어휘 리프) | `getRuntime` |

## `adapters/` — 순수 어댑터(벤더 SDK 없음)

| 파일 | 책임 | 주요 export |
|---|---|---|
| `composite.ts` | 가드된 컴포지트 팬아웃 + **dead-man's-switch**(per-sink 삼킨-실패 계측, rate-limited 최후 stderr 라인, `/health` 프로브용 `health()`) | `guardedCompositeReporter`, `compositeReporter`, `noopReporter` |

## 가드레일 (RFC §8 — 워크스페이스 차원)

- ESLint flat-config(루트): 벤더 SDK(sonner/@sentry — 동적 import 포함)는 `error-adapters`만, `Sentry.captureException` 직접 호출·JSX `{error.message}` 렌더·`toast(...message)` 금지.
- 불변식 테스트: `catalog-invariants`(데이터 무결성·정확값 테이블), `pii-invariants`(§8-5 — telemetry 고정 어휘·payload PII strip), `serialize-client`(누출게이트 15코드), `decision-*`(매트릭스/precedence), `i18n-completeness`(key-echo 거부).
