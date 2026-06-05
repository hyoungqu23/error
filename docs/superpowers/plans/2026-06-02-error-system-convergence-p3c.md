# Error System 수렴 — P3c (아웃바운드 컷 / 보안 load-bearing) 구현 계획

> **For agentic workers:** subagent-driven + TDD. error-core 내부 응집 컷 — **단일 커밋**(serialize-client/result/route-handler/network-boundary 상호참조). green 게이트 = error-core만.

**Goal:** 아웃바운드/직렬화 레이어를 통합 `ClientErrorPayload` + `toClientErrorPayload` 누출 게이트로 컷한다. P3b-ii가 깐 `construct` shim(route-handler/network-boundary)을 걷어내고, 구 `serialize-client`(per-code `DETAILS_ALLOWLIST`/`gateClientDetails`/`toClientSerialized`)를 삭제(=단일 `semantics.detailsAllowlist`로 일원화). `result`의 wire 계약을 `DecisionResult`(in-process) vs `Result`(wire, `ClientErrorPayload`) 분리로(D3). `network-boundary`를 AppError 생산 + D2 guards로.

**⚠️ RED 스코프 유지:** error-core만 green. error-next/error-adapters/apps는 계속 red(P5/P6/P8). 게이트 = `pnpm --filter error-core typecheck && pnpm --filter error-core test`. **error-adapters는 이미 red**(P3b-ii) — 단, P3c가 새로 깨는 건 없어야 함(error-adapters는 serialize-client/result/route-handler를 import 안 함 — 확인).

**선행:** P3b-ii 완료(브랜치 `docs/error-system-convergence-p3a`, error-core 314 green). `decision/system.ts`의 `toClientErrorPayload(error, decision)`·`finalizeUnknown`·`DecisionResult`/`DecisionFailure`·`createDecisionSystem`. 근거 §5.3/§5.6 + D3/D5/D7.

---

## 핵심 설계 (P3c)

1. **누출 게이트 일원화:** 구 `serialize-client.ts`(toClientSerialized/DETAILS_ALLOWLIST/gateClientDetails/pickAllowed)를 **삭제**. 유일 게이트는 `system.toClientErrorPayload(error, decision)`(decision/system.ts:251 — surface/target 미포함, 단일 allowlist, correlationId/digest 스레딩). 데이터 동등성은 카탈로그 `detailsAllowlist`(VALIDATION→fieldErrors, RATE_LIMITED→retryAfterMs, 그 외 none)가 구 `DETAILS_ALLOWLIST`와 이미 일치(P2a/검증됨). 배럴에서 `toClientSerialized`/`DETAILS_ALLOWLIST`/`gateClientDetails`/`ClientSerializedError` export 제거.
2. **Result 모델 분리(D3):** `result.ts`의 wire `Result<T> = Success<T> | { ok:false; error: ClientErrorPayload }`. `actionSuccess` 유지. `actionFailure(DomainError)` **제거**(레지스트리-해소 payload가 필요했음 — 대체). 신설 `degrade<T>(r: DecisionResult<T>): Result<T>` — `DecisionFailure`면 `{ok:false, error: r.payload}`(서버측 AppError/decision/occurrence는 버림), `Success`면 그대로. `DecisionResult`/`DecisionFailure`/`Success`는 decision/system에서 re-export.
3. **route-handler(D5 status):** `httpStatus` getter 제거됨 → 카탈로그 `defaultHttpStatus`로. `toErrorResponse`를 **시스템 주입형**으로: `createErrorResponder(system) => (e, occurrence, correlationId) => Response`. 내부: `failure = system.finalizeUnknown(e, occurrence, {runtime:"server", correlationId})` → body=`failure.payload` → status=`system.errors[failure.error.code]?.defaultHttpStatus ?? 500` → `x-request-id` 헤더. (raw message/details 누출 없음 — payload가 게이트 통과분.)
4. **network-boundary AppError:** `construct` shim 제거 → `appError()` 생산. `isSerializedError`/`isClientSerializedError`(구, ALS) → **신 D2 guards**(`isSerializedError`/`isClientErrorPayload` from `decision/app-error`). `withCorrelation`/`fromSerialized`/`fromClientSerialized` → `AppError`. 8개 transport 코드 매핑·offline/timeout/abort 판별·429 Retry-After·x-correlation-id 쿠키 **verbatim 보존**. **D5**: RATE_LIMITED은 인스턴스 `retryAfterMs` set(+ allowlist 호환 위해 `details.retryAfterMs`도). client payload 분기(isClientErrorPayload)는 `messageKey` 키 기준.
5. **construct shim 제거:** route-handler/network-boundary의 P3b-ii `construct` 로컬 shim 삭제. (구 `construct`는 app-error.ts에 P3e까지 잔존 — composite.test 등 잔여 소비자용.)

---

## Task C2 (원자 컷): 아웃바운드 → ClientErrorPayload / 누출게이트 일원화

**한 커밋.** error-core green 게이트는 끝에 1회.

### (a) result.ts — wire Result + degrade(D3)
- [x] 재작성:

```typescript
// error/result.ts — wire 계약. in-process DecisionResult는 decision/system; wire는 ClientErrorPayload만.
import type { ClientErrorPayload } from "./decision/types";
import type { DecisionResult, DecisionFailure, Success } from "./decision/system";

export type { Success, DecisionResult, DecisionFailure };
export type Failure = { ok: false; error: ClientErrorPayload };
export type Result<T> = Success<T> | Failure;

export const actionSuccess = <T>(data: T): Success<T> => ({ ok: true, data });

/** in-process DecisionResult → wire Result. DecisionFailure의 payload만 건너고 AppError/decision/occurrence는 서버에 남긴다. */
export const degrade = <T>(r: DecisionResult<T>): Result<T> =>
  r.ok ? r : { ok: false, error: r.payload };
```

(구 `actionFailure`/`toClientSerialized` import 제거. `Success`는 decision/system의 것으로 통일.)

### (b) route-handler.ts — 시스템 주입형 responder(D5 status)
- [x] 재작성:

```typescript
// error/route-handler.ts — AppError/unknown → messageless, details-gated HTTP Response.
import type { DecisionSystem } from "./decision/system";
import type { OccurrenceContext } from "./decision/types";

/**
 * 주입된 decision-system으로 캐치값을 HTTP 응답으로 변환. body는 toClientErrorPayload 게이트
 * 통과분(ClientErrorPayload — message/details 누출 없음), status는 카탈로그 defaultHttpStatus.
 */
export const createErrorResponder =
  (system: DecisionSystem) =>
  (error: unknown, occurrence: OccurrenceContext, correlationId: string): Response => {
    const failure = system.finalizeUnknown(error, occurrence, { runtime: "server", correlationId });
    const status = system.errors[failure.error.code]?.defaultHttpStatus ?? 500;
    return Response.json(failure.payload, { status, headers: { "x-request-id": correlationId } });
  };
```

(구 `toErrorResponse(e, correlationId)` 시그니처 제거 — error-next route handler(P5/red)가 새 형태 채택. `construct`/`DomainError`/`toClientSerialized` import 제거.)

### (c) network-boundary.ts — AppError 생산 + D2 guards
- [x] P3b-ii shim 제거, 다음으로:
  - `import { AppError, appError, isSerializedError, isClientErrorPayload, type SerializedError } from "./decision/app-error";` (구 construct shim/`makeError` 로컬 삭제).
  - 내부 `makeError`(construct shim) → `appError(code, details, opts)` 직접 호출 또는 얇은 로컬 `const mk = (code, details=null, cause?) => appError(code, details, {cause})`.
  - `withCorrelation(err: AppError, correlationId?)`: `correlationId && !err.correlationId ? AppError.fromSerialized({ ...err.toSerialized(), correlationId }) : err`.
  - non-ok body 분기: `isSerializedError(body)` → `AppError.fromSerialized(body)`; `isClientErrorPayload(body)` → `withCorrelation(AppError.fromClientSerialized(body), correlationId)`.
  - **429(D5):** `appError("RATE_LIMITED", retryAfterMs!==undefined ? { retryAfterMs } : null, { retryAfterMs })` — 인스턴스 필드 + details 둘 다(allowlist 호환).
  - 5xx/4xx: `appError(code, { status })`. SCHEMA_MISMATCH: `appError("SCHEMA_MISMATCH", { endpoint: String(url) }, { cause })`.
  - offline/timeout/abort 판별 + 쿠키/헤더 correlationId 로직 **verbatim 보존**.

### (d) serialize-client.ts 삭제 + 배럴 정리
- [x] `rm packages/error-core/src/serialize-client.ts`.
- [x] `index.ts`(배럴)에서 `toClientSerialized`/`gateClientDetails`/`DETAILS_ALLOWLIST`/`ClientSerializedError` export 제거. `degrade`/`createErrorResponder`/`ClientErrorPayload`(decision 경유) 추가 노출 확인. (구 `app-error.ts`의 `ClientSerializedError` 타입 자체는 P3e까지 잔존하나 배럴에서 내리거나 유지는 컴파일 따라 — 내부 미사용이면 유지 무해.)
- [x] grep: `toClientSerialized`/`gateClientDetails`/`DETAILS_ALLOWLIST`의 **error-core 내부** 잔존 importer 0 확인 후 삭제(있으면 그 소비자부터 컷).

### (e) 테스트 마이그레이션
- [x] `serialize-client.test.ts`(217줄, 누출 게이트) → **신 누출 게이트 테스트로 이전**: 테스트 `createDecisionSystem(CANONICAL_ERROR_SEMANTICS, ops)`로 `system.toClientErrorPayload(error, decision)`(또는 `finalizeUnknown(...).payload`)를 15개 코드에 대해 검증. **보존할 불변식(verbatim intent):** message/cause 미노출, JSON-safe, sibling 키 strip, VALIDATION.fieldErrors 통과, RATE_LIMITED.retryAfterMs 통과, FORBIDDEN.requiredRole/NOT_FOUND.resource/SCHEMA_MISMATCH.endpoint/HTTP.status 차단, surface/target 부재. 파일명은 `serialize-client.test.ts` 유지하되 대상이 toClientErrorPayload. (구 `gateClientDetails`/`DETAILS_ALLOWLIST` 직접 단언 → 카탈로그 detailsAllowlist + 게이트 결과로.)
- [x] `network-boundary.test.ts`(P3b-ii construct shim) → shim 제거, AppError/신 guards로. 26개 케이스의 transport-코드/Retry-After/correlation 단언 보존. (`as DomainError` → AppError; isSerializedError 경로 신 guard.)
- [x] route-handler 테스트가 없으면 신규 추가(선택): `createErrorResponder(system)`가 status=defaultHttpStatus, body=payload(message 없음), x-request-id 헤더를 내는지 1–2 케이스.

### (f) green 게이트 + 단일 커밋
- [x] `cd packages/error-core && pnpm typecheck && pnpm test` → green. (카운트: serialize-client.test 이전, network-boundary.test 유지, route-handler 신규.) 워크스페이스는 error-next/adapters/apps red 유지(예상). `pnpm --filter error-adapters test` → P3b-ii와 **동일한 4 fail(sonner-presenter)만** — P3c가 새로 깨는 것 없음 확인.
- [x] 커밋:
```bash
git add packages/error-core/src
git rm packages/error-core/src/serialize-client.ts
git commit -m "feat(error-core)!: unify leak gate on toClientErrorPayload, Result degrade, AppError network-boundary (P3c)

Delete serialize-client (DETAILS_ALLOWLIST/gateClientDetails/toClientSerialized) — superseded by
decision/system toClientErrorPayload (single semantics.detailsAllowlist). result: wire Result carries
ClientErrorPayload + degrade(DecisionResult). route-handler: createErrorResponder(system), status from
catalog defaultHttpStatus. network-boundary produces AppError + D2 guards; remove P3b-ii construct shims.

Still kernel-only RED: error-next (P5)/error-adapters (P6)/apps (P8)."
git commit --allow-empty -m "chore(error-core): P3c complete — single leak gate + AppError outbound; RED unchanged"
```

---

## 리스크 & 가드
- **누출 게이트(최고 위험):** serialize-client.test 이전 시 **불변식 약화 금지** — 15개 코드 allowlist 결과가 구 DETAILS_ALLOWLIST와 동일함을 코드별로 단언. surface/target/message/cause 부재 + 전체 AppError 미직렬화. decision-system.test의 leak 테스트와 중복돼도 좋음(누출은 다중 방어 가치).
- **network-boundary 동작 보존:** 8 transport 코드·offline/timeout/abort 판별·429 Retry-After·correlation 쿠키/헤더 verbatim. 26 테스트로 검증.
- **route-handler status:** 카탈로그 defaultHttpStatus가 구 registry httpStatus와 일치(P2a 매핑 검증됨) — 401/403/404/422/429/500/502/503/504.
- **error-adapters 회귀 금지:** P3c는 serialize-client/result/route-handler를 error-adapters가 import 안 함 → 새 fail 없어야. 게이트에서 `pnpm --filter error-adapters test`가 P3b-ii와 동일(4 fail)인지 확인.

## Self-Review
- §5.3 누출 게이트 일원화(serialize-client 삭제→toClientErrorPayload), §5.6 Result 분리(degrade, D3), D5(network-boundary 인스턴스 retryAfterMs), D2(신 guards), D7(construct shim 제거) 반영. ✅
- 원자 커밋 + per-package green 게이트 + red 스코프 유지 명시. ✅
- 누출 테스트 불변식 보존(약화 금지) 강조. ✅
