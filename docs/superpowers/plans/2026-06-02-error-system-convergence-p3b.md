# Error System 수렴 — P3b (인바운드 컷오버) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development + superpowers:test-driven-development. Checkbox(`- [x]`) 스텝.

**Goal:** error-core의 "인바운드 경로"(에러 생성·정규화 + 그 즉시 소비자)를 통합 `AppError`로 컷오버한다. **옵션 A 재분해**: 안전한 leaf(P3b-i, green 유지)와 원자 컷(P3b-ii)을 분리한다.

**Architecture:** P3a가 `decision/`에 `AppError`/`createDecisionSystem`/sinks를 비파괴 착륙시켰다. P3b는 구 모듈을 그 위로 컷오버한다. **에러 생산(make-error/normalize)과 그 소비자(handle-error/handler/sink 타입)는 sink 타입 결합 때문에 한 단계(P3b-ii)에서 원자적으로 잘라야** 중간 green이 유지된다(분리하면 handle-error가 깨짐 — 실측 확인됨).

**선행:** P0–P3a 완료(브랜치 `docs/error-system-convergence-p3a`, error-core 322 green, 워크스페이스 7/7). 근거 스펙 §5.x + 잠긴 결정 D1–D7(P3a 계획 문서).

---

## ⚠️ 스코프 전환: P3b-ii부터 워크스페이스가 "red"가 된다 (kernel-only)

P0–P3a는 **워크스페이스 7/7 green**을 유지했다(additive). **P3b-i까지도 green.** 그러나 **P3b-ii는 `error-core`의 인바운드 모델을 바꾸므로 그 구 표면을 소비하는 `error-next`(`request-handler.server.ts`·`ErrorFallback`·`safe-*`)와 `apps`가 컴파일 깨진다.** 이는 승인된 kernel-only 스코프(P3는 error-core만 per-package green; error-next=P5, apps=P8)의 의도된 결과다.

- **per-package 게이트**: P3b-ii 이후 `pnpm --filter error-core test/typecheck`만 green을 요구한다. 워크스페이스 전체(`pnpm test`)는 error-next/apps에서 실패한다 — **예상된 상태**.
- 이 red는 P5(error-next)·P8(apps)에서 해소된다. P3b-ii 계획 헤더에 반드시 재명시.

---

## P3b-i: leaf 리더 AppError 수용 (green 유지)

**대상:** `field-errors.ts`, `retry-after.ts`. (`translator.ts`는 에러를 생산/소비하지 않고 registry.ts에 의존 — **P3e의 registry 삭제까지 무수정**, P3b에서 제외.)

`isAppError`는 duck-type으로 **구 DomainError(name "DomainError")·신 AppError 둘 다** 인식하므로, 이 컷오버 후에도 두 종류 에러를 모두 처리 → 모든 테스트 green.

### Task B1: field-errors.ts → isAppError + details 내로잉

**Files:** Modify `packages/error-core/src/field-errors.ts`; Test `packages/error-core/src/__tests__/field-errors.test.ts`

- [x] **Step 1: 테스트 먼저 — 신 AppError도 인식하는지 추가.** `field-errors.test.ts`에 케이스 추가(기존 4개 유지):

```typescript
import { appError } from "../decision/app-error";
// ...
it("extracts fieldErrors from a NEW AppError too (P3b-i)", () => {
  const e = appError("VALIDATION", { fieldErrors: { email: ["bad"] } });
  expect(fieldErrorsFromError(e)).toEqual({ email: ["bad"] });
});
it("returns null for AppError of another code", () => {
  expect(fieldErrorsFromError(appError("NOT_FOUND"))).toBeNull();
});
```

Run: `cd packages/error-core && pnpm vitest run src/__tests__/field-errors.test.ts` → 신 케이스 FAIL(현재 `isDomainError`는 신 AppError를 — 사실 duck-type이 아니라 instanceof old만 보므로 — 미인식할 수 있음).

- [x] **Step 2: 구현 변경.** `field-errors.ts`를 다음으로:

```typescript
// error/field-errors.ts — VALIDATION 에러의 per-field 맵 추출(구 DomainError·신 AppError 공통).
import { isAppError } from "./decision/app-error";

export const fieldErrorsFromError = (
  error: unknown,
): Record<string, string[]> | null => {
  if (!isAppError(error) || error.code !== "VALIDATION") return null;
  const fe = (error.details as { fieldErrors?: Record<string, string[]> } | null | undefined)?.fieldErrors;
  return fe ?? null;
};
```

(`isAppError`는 단일 인자라 code는 별도 비교. `AppError.details`가 `unknown`이라 명시적 내로잉.)

- [x] **Step 3:** `pnpm vitest run src/__tests__/field-errors.test.ts` → 전부 PASS(기존 4 + 신규 2). `pnpm test`(error-core) green(322+2). `cd /Users/hm2/Private/error-system && pnpm typecheck` → **7/7 green**(아직 additive 단계).

- [x] **Step 4: 커밋**
```bash
git add packages/error-core/src/field-errors.ts packages/error-core/src/__tests__/field-errors.test.ts
git commit -m "refactor(error-core): field-errors accepts AppError (old+new) via isAppError (P3b-i)"
```

### Task B2: retry-after.ts → isAppError + 인스턴스 retryAfterMs 우선(D5)

**Files:** Modify `packages/error-core/src/retry-after.ts`; Test `packages/error-core/src/__tests__/network-boundary.test.ts`(간접) 또는 신규 `retry-after.test.ts`

- [x] **Step 1: 테스트 먼저** — `retryAfterHintFromError`가 신 AppError의 인스턴스 필드(top-level `retryAfterMs`)와 구 DomainError의 `details.retryAfterMs` 둘 다 읽는지. 신규 `packages/error-core/src/__tests__/retry-after.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { retryAfterHintFromError, parseRetryAfter } from "../retry-after";
import { appError } from "../decision/app-error";

describe("retryAfterHintFromError (P3b-i)", () => {
  it("reads top-level retryAfterMs from a new AppError (D5 single source)", () => {
    expect(retryAfterHintFromError(appError("RATE_LIMITED", null, { retryAfterMs: 5000 }))).toBe(5000);
  });
  it("falls back to details.retryAfterMs (legacy shape)", () => {
    expect(retryAfterHintFromError(appError("RATE_LIMITED", { retryAfterMs: 3000 }))).toBe(3000);
  });
  it("returns undefined for non-AppError or missing hint", () => {
    expect(retryAfterHintFromError(new Error("x"))).toBeUndefined();
    expect(retryAfterHintFromError(appError("TIMEOUT"))).toBeUndefined();
  });
});
describe("parseRetryAfter unchanged", () => {
  it("delta-seconds", () => { expect(parseRetryAfter("120")).toBe(120000); });
});
```

Run → 신 케이스 FAIL.

- [x] **Step 2: 구현 변경.** `retry-after.ts`의 import + `retryAfterHintFromError`만 변경(`parseRetryAfter`는 그대로):

```typescript
import { isAppError } from "./decision/app-error";
// parseRetryAfter: 변경 없음 ...

/** 서버 제공 retry 힌트(ms): 인스턴스 retryAfterMs(D5 단일 소스) 우선, 없으면 details.retryAfterMs(레거시). */
export const retryAfterHintFromError = (err: unknown): number | undefined => {
  if (!isAppError(err)) return undefined;
  const valid = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
  if (valid(err.retryAfterMs)) return err.retryAfterMs;
  const details = err.details as { retryAfterMs?: unknown } | null | undefined;
  return valid(details?.retryAfterMs) ? (details!.retryAfterMs as number) : undefined;
};
```

- [x] **Step 3:** `pnpm vitest run src/__tests__/retry-after.test.ts` PASS. `pnpm test`(error-core) green. 워크스페이스 typecheck **7/7**.

- [x] **Step 4: 커밋**
```bash
git add packages/error-core/src/retry-after.ts packages/error-core/src/__tests__/retry-after.test.ts
git commit -m "refactor(error-core): retry-after reads AppError instance retryAfterMs first (P3b-i, D5)"
```

### Task B3: P3b-i 게이트
- [x] `pnpm test`(error-core) green; `cd /Users/hm2/Private/error-system && pnpm typecheck && pnpm test` → **워크스페이스 여전히 7/7 green**(P3b-i는 additive-safe). 커밋(빈 마커 선택):
```bash
git commit --allow-empty -m "chore(error-core): P3b-i complete — leaf readers accept AppError, workspace still green"
```

---

## P3b-ii: 원자 컷 (make-error+normalize+handle-error+handler+sink 타입) — ⚠️ error-next/apps RED 진입

> **이 단계는 별도 go-ahead 후 상세 bite-sized 계획으로 전개한다** — error-next/apps를 red로 만드는 결정적 단계라, 착수 전 확인이 필요하다. 아래는 구조 아웃라인.

**대상 + 변환:**
- `make-error.ts`: `makeError`/`construct`가 `AppError`를 생산. **D1**: per-code details 검증을 zod `ErrorDetailsSchema` → `semantics.validateDetails`로(또는 과도기엔 zod 유지하되 AppError 반환). `unknownCodeForRuntime` 유지. `severity`/`retryable` 옵션 제거(AppError에 per-instance 정책 없음).
- `normalize.ts`: `normalizeToDomainError`→`normalizeToAppError`(구 이름 alias **버림** D7), `DomainError`→`AppError`, `isDomainError`→`isAppError`. **4개 분기 순서 + correlationId 우선 verbatim 보존.** `isSerializedError`/`isClientSerializedError`의 `getActiveErrorRegistry` 의존 제거 → **D2 frozen code-set**(`isKnownErrorCode`, codes.ts). `fromSerialized`/`fromClientSerialized`는 신 `AppError` 정적/free.
- `handle-error.ts`: **D4** — `createHandleError`를 `resolveErrorDecision`+`executeErrorDecision` 래핑으로 재작성. `resolvePolicy`/`ResolvedAppError` 의존 제거. `HandleErrorOptions{present,log,severity}`는 occurrence/telemetry override(5% escape hatch)로 매핑. 반환형 `ResolvedAppError`→`DecisionResult`/`UserErrorDecision`. guardSink + capture→breadcrumb→alert 순서 보존.
- `handler.ts`: `setActiveErrorRegistry(deps.registry)` 호출 제거(카탈로그는 decision-system 보유). 반환형 조정.
- `telemetry.ts`/`notifier.ts`: `Reporter`/`Presenter`/`Notifier` 시그니처 `DomainError`→`AppError`. 신 `ReporterSink`/`NotifierSink`(decision/types)와 수렴(시그니처만; 벤더 capture/breadcrumb/alert 재배선은 P6).
- `types.ts`: `HandleErrorDeps.registry: ErrorRegistry` 제거 → 카탈로그/decision-system 핸들로.
- **카탈로그(catalog.ts)**: **D1 적용** — `VALIDATION`(`fieldErrors`)·`RATE_LIMITED`(`retryAfterMs`) 등에 `validateDetails` type-guard 작성 → `sys.fail` per-code 타이핑 활성화(P3a에서 미작성으로 남긴 갭).

**테스트 마이그레이션(in-commit):**
- `make-error.test.ts`: AppError 생산 단언, severity/retryable 옵션 단언 제거.
- `rehydration.test.ts`: DomainError→AppError, normalizeToDomainError→normalizeToAppError, fromSerialized 라운드트립 + UNKNOWN_* fallback 보존.
- `handle-error.test.ts`(360줄): `runWithErrorRegistry(DEFAULT_ERROR_REGISTRY, …)` 래퍼 제거, `resolveErrorDecision`/`executeErrorDecision`로 단언, 카탈로그 명시 주입. `ResolvedAppError{error,code,policy}` 단언 → decision 기반.
- `impact-breadcrumb.test.ts`: runWithErrorRegistry 래퍼 제거, breadcrumb가 `decision.telemetry.breadcrumb` 기반으로 발화.
- `composite.test.ts`: reporter sink를 AppError로 재타이핑.
- **신규**: createDecisionSystem 카탈로그 주입 테스트(구 ALS substitution 테스트 대체); `sys.fail`의 `@ts-expect-error` per-code 음성 타입 테스트(D1 활성화 후).

**게이트(P3b-ii):** `pnpm --filter error-core typecheck && pnpm --filter error-core test` green. **워크스페이스 전체는 error-next/apps 실패 — 예상**. P3b-ii 완료 마커에 "error-next/apps red until P5/P8" 명시.

**리스크:** (1) handle-error 360줄 테스트 마이그레이션 mis-migration(false-green) — 의도 보존 in-commit. (2) D2 멤버십 가드 의미 변화(forged code) — fromSerialized UNKNOWN_* fail-closed 유지 확인. (3) D1 validateDetails 작성 시 기존 동작(zod 검증) 동등성 — 카탈로그 type-guard가 zod와 같은 거부를 하는지. (4) normalize 4분기 순서 회귀 — verbatim 보존 + rehydration 테스트.

---

## Self-Review

**Spec coverage:** P3b-i = leaf 리더(field-errors/retry-after) AppError 수용(D5 retryAfterMs 소스). P3b-ii = 인바운드 원자 컷(make-error/normalize/handle-error/handler/sink) + D1·D2·D4 적용 + 카탈로그 validateDetails. translator 재소싱·구 모델 삭제는 P3e. ✅
**핵심 결정 반영:** 옵션 A 재분해(leaf green / 원자 컷), kernel-only red 전환 명시, D1/D2/D4/D5/D7 매핑. ✅
**Placeholder:** P3b-i는 완전 코드. P3b-ii는 의도적으로 아웃라인(red 유발 전 go-ahead 필요) — 헤더에 명시. ✅
