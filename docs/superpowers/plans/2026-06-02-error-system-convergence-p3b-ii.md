# Error System 수렴 — P3b-ii (인바운드 원자 컷) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development + test-driven-development. 단, **P3b-ii는 단일 원자 커밋**이다 — make-error/normalize/handle-error가 sink·타입으로 묶여 분리 시 error-core가 중간 컴파일 안 됨. 작업을 단계적으로 하되 **green 게이트 + 커밋은 컷이 끝난 1회**.

**Goal:** error-core의 인바운드 경로(make-error/normalize)를 `AppError` 생산으로, 그 소비자(handle-error)를 결정 모델(`createDecisionSystem` 위임)로 원자적으로 컷오버한다. ALS-읽는 멤버십 가드를 정적 frozen code-set(D2)으로, 카탈로그에 `validateDetails`(D1)를 작성한다.

**⚠️ RED 스코프:** P3b-ii는 **error-next·apps를 컴파일 깨뜨린다**(P5/P8까지 red). **게이트 = `pnpm --filter error-core typecheck && pnpm --filter error-core test`만 green.** 워크스페이스 전체 `pnpm test`는 error-next/apps 실패 — **예상·정상**. **단, `error-adapters`는 green 유지**(아래 설계로 구 `Reporter/Presenter/Notifier` 인터페이스를 안 건드림).

**선행:** P3b-i 완료(브랜치 `docs/error-system-convergence-p3a`, error-core 328 green). `decision/system.ts`(P3a)가 `createDecisionSystem`/`finalizeUnknown`/`executeErrorDecision`/`toClientErrorPayload`/`DecisionFailure`/`ReporterSink`/`NotifierSink`를 제공. 근거: §5.x + D1/D2/D4/D5/D7.

---

## 핵심 설계 결정 (P3b-ii)

1. **blast 최소화 — 구 sink 인터페이스 무수정:** `telemetry.ts`(`Reporter`/`Presenter`)·`notifier.ts`(`Notifier`)·`adapters/console-reporter.ts`·`composite.ts`는 **건드리지 않는다.** handle-error가 이들을 *그만 쓰고* 신 `ReporterSink`/`NotifierSink`(decision/types)를 쓴다. → `error-adapters`(구 인터페이스 구현체)·`composite.test.ts`는 **green 유지.** 구 인터페이스 삭제는 P3e/P6.
2. **handle-error = 결정 시스템 위의 얇은 위임자(D4):** `createHandleError`를 재작성. `DecisionSystem` + `{reporter: ReporterSink, notifier: NotifierSink}`를 받아 `system.finalizeUnknown(input, occurrence, runtime)` → `system.executeErrorDecision(failure.error, failure.decision, ctx, sinks)` → `DecisionFailure` 반환. **Presenter 개념 제거**(표현은 소비자/UI의 몫 — 결정 모델 원칙). `resolvePolicy`/`ResolvedAppError`/`HandleErrorOptions{present,log}` 의존 제거. `HandleErrorOptions{severity}` 등 override는 `FailureOptions.telemetry`(5% escape hatch)로 매핑.
3. **make-error → AppError:** `makeError`/`construct`가 `appError()`(decision/app-error)를 생산. zod `ErrorDetailsSchema` 검증은 **과도기 유지**(invalid → UNKNOWN_* fallback 동작 보존; schema.ts 삭제는 P3e). `severity`/`retryable` 옵션 제거.
4. **normalize → normalizeToAppError:** `AppError`·`isAppError`·신 guards. **4개 분기 순서 + correlationId 우선 verbatim 보존.** 구 `normalize` alias 버림(D7).
5. **D2 멤버십 가드:** `decision/app-error.ts`에 신 `isSerializedError`/`isClientSerializedError` 추가 — `getActiveErrorRegistry` 대신 `isKnownErrorCode`(codes.ts) 사용. `ClientErrorPayload`는 `messageKey`(구 `userMessageKey` 아님) 키로 판별. 구 guards(구 app-error.ts)는 그대로(구 스택용).
6. **D1 카탈로그 validateDetails:** `catalog.ts`의 `VALIDATION`(`fieldErrors`)·`RATE_LIMITED`(`retryAfterMs`)에 type-guard 작성 → finalize 검증 게이트(system.ts:286) 활성 + `sys.fail` per-code 타이핑 활성.
7. **types.ts `HandleErrorDeps` 개편:** `registry`/구 sink 제거 → 신 deps(`system` + `ReporterSink`/`NotifierSink`) 또는 createHandleError 인자로 흡수.

---

## Task C1 (원자 컷): 인바운드 + handle-error를 AppError/결정 모델로

**한 커밋.** 아래 순서로 작업하되 green 체크는 마지막. 각 파일 변경:

### (a) decision/app-error.ts — D2 guards 추가
- [ ] 신 guards 추가(구 guards 미수정):

```typescript
// decision/app-error.ts 에 추가
import { isKnownErrorCode } from "./codes";
import type { ClientErrorPayload } from "./types";

/** 서버-신뢰 wire(SerializedError) 가드 — 코드 known 여부를 정적 code-set으로(ALS 불사용, D2). */
export const isSerializedError = (e: unknown): e is SerializedError =>
  typeof e === "object" && e !== null && "code" in e && "message" in e &&
  typeof (e as SerializedError).code === "string" && isKnownErrorCode((e as SerializedError).code);

/** 클라-신뢰 wire(ClientErrorPayload) 가드 — messageKey 보유 + message 부재 + known code(D2). */
export const isClientErrorPayload = (e: unknown): e is ClientErrorPayload =>
  typeof e === "object" && e !== null && "code" in e && "messageKey" in e && !("message" in e) &&
  typeof (e as ClientErrorPayload).code === "string" &&
  typeof (e as ClientErrorPayload).messageKey === "string" &&
  isKnownErrorCode((e as ClientErrorPayload).code);
```

(주의: import cycle — `decision/app-error.ts` → `./types`(ClientErrorPayload) → `./app-error`(AppError) 는 type-only라 OK. `./codes`는 값 import.)

### (b) make-error.ts — AppError 생산
- [ ] 재작성:

```typescript
// error/make-error.ts — AppError 생산. 검증은 zod ErrorDetailsSchema 과도기 유지(P3e에서 D1 validateDetails로 일원화).
import { ErrorDetailsSchema } from "./schema";
import { appError, AppError } from "./decision/app-error";
import { getRuntime } from "./runtime";
import type { ErrorCode } from "./decision/codes";

export const unknownCodeForRuntime = (): "UNKNOWN_SERVER_ERROR" | "UNKNOWN_CLIENT_ERROR" =>
  getRuntime() === "server" ? "UNKNOWN_SERVER_ERROR" : "UNKNOWN_CLIENT_ERROR";

export interface MakeErrorInput {
  code: ErrorCode;
  details?: unknown;
  message?: string;
  cause?: unknown;
  correlationId?: string;
  retryAfterMs?: number;
  userCanRetry?: boolean;
  digest?: string;
}

export const makeError = (opts: MakeErrorInput): AppError => {
  const parsed = ErrorDetailsSchema[opts.code].safeParse(opts.details);
  if (!parsed.success) {
    return appError(unknownCodeForRuntime(), null, {
      message: opts.message ?? "알 수 없는 오류가 발생했습니다.",
      cause: opts.cause ?? opts.details, correlationId: opts.correlationId, digest: opts.digest,
    });
  }
  return appError(opts.code, parsed.data, {
    message: opts.message, cause: opts.cause, correlationId: opts.correlationId,
    retryAfterMs: opts.retryAfterMs, userCanRetry: opts.userCanRetry, digest: opts.digest,
  });
};
```

(구 `AppErrorOptions<C>`/`construct` 의존 제거. `severity`/`retryable` 옵션 삭제. `ErrorCode`는 `decision/codes`에서.)

### (c) normalize.ts — normalizeToAppError
- [ ] 재작성 — **4분기 순서·correlationId 우선 verbatim**, `DomainError`→`AppError`, 신 guards:

```typescript
// error/normalize.ts — 임의 캐치값 → AppError. 분기 순서 load-bearing(verbatim 보존).
import { AppError, appError, isAppError, isSerializedError, isClientErrorPayload, type SerializedError } from "./decision/app-error";
import { makeError, unknownCodeForRuntime } from "./make-error";
import type { ErrorCode } from "./decision/codes";

export function normalizeToAppError(input: unknown, fallbackMessage?: string, correlationId?: string): AppError {
  if (isAppError(input)) return stampCorrelation(input, correlationId);          // 1
  if (isSerializedError(input)) {                                                 // 2
    const withId: SerializedError = input.correlationId === undefined && correlationId !== undefined ? { ...input, correlationId } : input;
    return AppError.fromSerialized(withId);
  }
  if (isClientErrorPayload(input)) {                                              // 2b
    const withId = input.correlationId === undefined && correlationId !== undefined ? { ...input, correlationId } : input;
    return AppError.fromClientSerialized(withId);
  }
  if (input instanceof Error) {                                                   // 3
    const mapped = mapKnownError(input, correlationId);
    if (mapped) return mapped;
  }
  return makeError({ code: unknownCodeForRuntime() as ErrorCode, details: null, message: fallbackMessage ?? messageOf(input), cause: input, correlationId }); // 3b/4
}
// mapKnownError / stampCorrelation / messageOf: 구 로직 그대로, DomainError→AppError, makeError 입력형만 맞춤.
// stampCorrelation: AppError.fromSerialized({ ...e.toSerialized(), correlationId }) (불변, 재구축).
// 구 `export const normalize = ...` alias 삭제(D7).
```

### (d) catalog.ts — D1 validateDetails (VALIDATION, RATE_LIMITED)
- [ ] 두 코드에 type-guard 추가:

```typescript
  VALIDATION: {
    // ...기존 필드...
    validateDetails: (d): d is { fieldErrors: Record<string, string[]> } =>
      typeof d === "object" && d !== null && "fieldErrors" in d &&
      typeof (d as { fieldErrors: unknown }).fieldErrors === "object",
  },
  RATE_LIMITED: {
    // ...기존 필드...
    validateDetails: (d): d is { retryAfterMs: number } =>
      typeof d === "object" && d !== null && typeof (d as { retryAfterMs: unknown }).retryAfterMs === "number",
  },
```

(검증: validateCatalog는 여전히 통과; finalize 게이트(system.ts:286)가 invalid VALIDATION/RATE_LIMITED details를 fallback으로 강등. `sys.fail("VALIDATION", {잘못})`이 컴파일 에러 — P3a에서 드롭한 `@ts-expect-error` 테스트를 이제 추가.)

### (e) handle-error.ts — 결정 시스템 위임자로 재작성(D4)
- [ ] 재작성:

```typescript
// error/handle-error.ts — 결정 시스템 위임자. 정책은 resolveErrorDecision; 실행은 executeErrorDecision.
import type { DecisionSystem, DecisionFailure } from "./decision/system";
import type { ReporterSink, NotifierSink, TelemetryContext, OccurrenceContext, RuntimeContext, TelemetryDecision } from "./decision/types";

export interface HandleErrorOptions {
  occurrence?: Partial<OccurrenceContext>;
  telemetry?: Partial<TelemetryDecision>; // 5% escape hatch (구 present/log/severity override 대체)
  fallbackMessage?: string;
  ctx?: Partial<TelemetryContext>;
}
export interface HandleErrorSinks { reporter: ReporterSink; notifier: NotifierSink; }

const guardSink = (fn: () => void): void => { try { fn(); } catch { /* 에러 처리가 에러 소스가 되면 안 됨 */ } };

/**
 * 주어진 decision-system + sinks로 캐치값을 처리한다. finalizeUnknown으로 결정·payload를 만들고
 * executeErrorDecision으로 텔레메트리를 실행(capture→breadcrumb→alert). DecisionFailure 반환.
 */
export const createHandleError =
  (system: DecisionSystem, sinks: HandleErrorSinks, baseCtx: TelemetryContext, baseOccurrence: OccurrenceContext) =>
  (input: unknown, options: HandleErrorOptions = {}): DecisionFailure => {
    const occurrence = { ...baseOccurrence, ...options.occurrence };
    const runtime: Partial<RuntimeContext> = { runtime: baseCtx.runtime, correlationId: baseCtx.correlationId, route: baseCtx.route, user: baseCtx.user };
    let failure = system.finalizeUnknown(input, occurrence, runtime);
    if (options.telemetry) failure = { ...failure, decision: { ...failure.decision, telemetry: { ...failure.decision.telemetry, ...options.telemetry } } };
    const ctx: TelemetryContext = { ...baseCtx, ...options.ctx };
    guardSink(() => system.executeErrorDecision(failure.error, failure.decision, ctx, sinks));
    return failure;
  };
```

(구 `resolvePolicy`/`ResolvedAppError`/`Reporter`/`Presenter`/`Notifier`/`PresentAction`/`LogLevel` import 전부 제거. Presenter 없음. fan-out 순서는 executeTelemetryDecision(system.ts:347 capture→breadcrumb→alert)이 보존.)

### (f) handler.ts — initHandleError 재구성 + setActiveErrorRegistry 제거
- [ ] `setActiveErrorRegistry(deps.registry)` 호출 삭제. `initHandleError`를 신 `createHandleError(system, sinks, ctx, occurrence)` 기반으로. 싱글턴 `handleError`/`setErrorUser`/`safeHandler` 시그니처 조정. (구 `HandleErrorDeps` 의존 제거.)

### (g) types.ts — HandleErrorDeps 개편
- [ ] `HandleErrorDeps`(registry+구 sink)를 삭제하거나 신 형태(`{ system: DecisionSystem; reporter: ReporterSink; notifier: NotifierSink }`)로. 구 `Reporter`/`Presenter`/`Notifier` import 제거(그 인터페이스 파일 자체는 유지).

### (h) 테스트 마이그레이션 (같은 커밋)
- [ ] `make-error.test.ts`: `AppError` 생산 단언; severity/retryable 옵션 단언 제거; invalid details → UNKNOWN_* fallback 유지.
- [ ] `rehydration.test.ts`: `DomainError`→`AppError`, `normalizeToDomainError`→`normalizeToAppError`, `isDomainError`→`isAppError`; fromSerialized 라운드트립 + UNKNOWN_* fallback + correlationId 보존. 신 guards(isClientErrorPayload) 경로.
- [ ] `handle-error.test.ts`: 구 파이프라인(resolvePolicy/present/ResolvedAppError) 테스트를 **신 위임자 테스트로 재작성** — 테스트용 `createDecisionSystem(CANONICAL_ERROR_SEMANTICS, ops)` + spy sinks를 만들어, `createHandleError`가 (1) DecisionFailure 반환 (2) capture/breadcrumb/alert를 decision.telemetry대로 호출 (3) options.telemetry override 적용. **단정 수는 줄어도 됨** — 엔진 동작은 decision-system.test.ts가 이미 커버하므로 여기선 위임 배선만 검증.
- [ ] `impact-breadcrumb.test.ts`: 구 handle-error breadcrumb 동작 테스트 → **삭제**(신 breadcrumb는 executeTelemetryDecision, decision-system.test.ts가 커버). 삭제 사유를 커밋 메시지에 명시.
- [ ] `composite.test.ts`·`i18n-completeness.test.ts`: **무수정**(구 Reporter/composite·translator 미변경이라 그대로 green).
- [ ] **신규**(decision-system.test.ts 또는 신 파일): `@ts-expect-error sys.fail("VALIDATION", {잘못된 details})` per-code 음성 타입 테스트(D1 활성화 확인).

### (i) green 게이트 + 단일 커밋
- [ ] `cd packages/error-core && pnpm typecheck && pnpm test` → **green**(카운트 변동: impact-breadcrumb 삭제 -N, handle-error 축소, +@ts-expect-error). 워크스페이스: `pnpm --filter error-core ...`만 요구. `pnpm typecheck`(전체)는 **error-next/apps 실패 정상, error-adapters는 PASS여야 함**(구 인터페이스 무수정 확인 — 만약 error-adapters가 깨지면 구 sink를 잘못 건드린 것 → 되돌릴 것).
- [ ] 커밋:
```bash
git add packages/error-core/src
git commit -m "feat(error-core)!: cut inbound path + handle-error to AppError/decision model (P3b-ii)

BREAKING: error-next/apps no longer compile against error-core until P5/P8 (kernel-only scope).
error-adapters stays green (old Reporter/Presenter/Notifier interfaces untouched)."
```
- [ ] 마커:
```bash
git commit --allow-empty -m "chore(error-core): P3b-ii complete — inbound on AppError; error-next/apps RED until P5/P8; error-adapters green"
```

---

## 리스크 & 가드
- **handle-error.test.ts 재작성 false-green:** 위임 배선(3개 단언)만 검증하되, capture/breadcrumb/alert가 decision.telemetry 불리언대로 호출되는지 spy로 정확히 확인.
- **normalize 4분기 회귀:** verbatim 보존 + rehydration.test로 검증. 신 guards(isSerializedError/isClientErrorPayload)가 known-code만 통과 — forged code는 분기 4(UNKNOWN_*)로 fail-closed.
- **D1 finalize 게이트 동등성:** validateDetails가 zod와 동일한 거부를 하는지(VALIDATION fieldErrors 형상, RATE_LIMITED retryAfterMs number). 불일치 시 invalid가 fallback으로 강등돼도 안전(누출 없음).
- **error-adapters 회귀 금지:** 구 sink 인터페이스 무수정 불변식 — 게이트에서 `pnpm --filter error-adapters test` green 확인.

## Self-Review
- D1(catalog validateDetails)·D2(frozen code-set guards)·D4(handle-error 위임 재작성, Presenter 제거)·D5(retryAfterMs 인스턴스)·D7(normalize alias 버림) 반영. ✅
- blast 최소화(error-adapters green) 설계 명시. ✅
- 원자 커밋(중간 green 불가) + per-package 게이트 + red 스코프 명시. ✅
- handle-error 360줄 테스트 → 위임 테스트 재작성 + impact-breadcrumb 삭제(신 엔진 테스트가 커버) 명시. ✅
