# P3e — 커널 구 스택 완전 제거 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `error-core` 커널에서 신 decision 모델로 대체된 구 스택(DomainError/active-registry/registry/schema/policy/severity + 구 sink telemetry/notifier/composite/console-reporter)을 **전부 제거**하여, 커널이 통합 decision 모델만 담도록 한다.

**Architecture:** 신 실행 경로(`decision/system.ts`)는 이미 신 sink(`ReporterSink`/`NotifierSink`)·신 `AppError`·catalog(`CANONICAL_ERROR_SEMANTICS`)로 완성돼 있다. 구 스택은 (1) 배럴 re-export, (2) error-adapters(P6)/error-next(P5)/apps(P8) 소비자(이미 red), (3) 일부 테스트, (4) **3개의 live 커널 엣지**로만 살아있다. 이 3개 엣지(`decision/codes.ts`→registry, `translator.ts`→registry, `make-error.ts`→schema)를 catalog로 re-point하면 구 클러스터 전체가 dead가 되고, 그때 안전히 삭제한다.

**Tech Stack:** TypeScript (strict), Vitest, pnpm workspace, tsc `--noEmit`.

**게이트(불변):** 매 Task 후 `pnpm --filter error-core typecheck && pnpm --filter error-core test`가 green이어야 한다. 워크스페이스 전체 테스트는 게이트가 **아니다** — `error-next`(P5)·`error-adapters`(P6)·`apps`(P8)는 의도적으로 red 유지. P3e는 **kernel-only** 스코프다.

---

## 배경 — 왜 "전체 제거"가 유일하게 일관된 P3e인가

핸드오프(`docs/superpowers/handoffs/2026-06-02-...-handoff.md`)는 P3e를 "구 DomainError/active-registry는 지금 삭제, 구 sink(Reporter/Presenter/Notifier)는 P6 보류"로 분리했다. 그러나 실제 import 그래프 검증 결과 **구 `DomainError` 클래스가 전체 구 클러스터를 살려두는 keystone**이다:

```
구 클러스터 (신 경로에선 완전 dead — 배럴 re-export·구 소비자(red)·테스트만 살려둠)
  app-error.ts (DomainError 클래스 + resolvePolicy/ResolvedPolicy/ResolvedAppError/
                isExpectedCode/구 isSerializedError/isClientSerializedError/construct/
                구 SerializedError/ClientSerializedError/AppError 타입 alias)
     ▲ 타입 의존         ▲ 먹임(import)
     │                  └── registry.ts(DEFAULT_ERROR_REGISTRY/ErrorMeta/ErrorRegistry/ErrorCode)
  telemetry.ts(Reporter/Presenter)   schema.ts(ErrorDetailsSchema/ErrorDetailsMap, zod)
  notifier.ts(Notifier/AlertPolicy)  active-registry.ts(ALS: get/set/runWithErrorRegistry)
  adapters/console-reporter.ts       policy.ts(ErrorKind/PresentAction/LogLevel/HttpStatus)
  adapters/composite.ts              severity.ts(Severity)

신 경로가 구 클러스터에 거는 live 엣지 — 단 3개:
  ① decision/codes.ts → registry.ts (DEFAULT_ERROR_REGISTRY로 ErrorCode/KNOWN_ERROR_CODES 파생)
  ② translator.ts     → registry.ts (DEFAULT_ERROR_REGISTRY[code].userMessageKey로 KEY_TO_CODE)
  ③ make-error.ts     → schema.ts   (ErrorDetailsSchema zod 검증)
```

- 구 sink(telemetry/notifier/console-reporter/composite)는 **메서드를 구 `DomainError` 타입에 건다**. 그래서 "DomainError만 삭제, sink는 보류"는 불가능 — sink가 DomainError를 잡고 있다.
- catalog(`decision/catalog.ts`의 `CANONICAL_ERROR_SEMANTICS`)는 **15코드 전부**를 `defaultMessageKey`/`category`/`detailsExposure`/(2코드) `validateDetails`와 함께 담는다. ①②③를 catalog로 re-point하면 구 클러스터의 live 엣지가 0이 되어 한 번에 dead가 된다.
- 신 실행 경로(`decision/system.ts` `executeErrorDecision`/`executeTelemetryDecision`)는 `decision/types.ts`의 `ReporterSink`(`capture`/`breadcrumb`)·`NotifierSink`(`alert`)만 쓴다 — 구 `Reporter`/`Presenter`/`Notifier`를 전혀 호출하지 않는다(검증됨).

→ 따라서 의미 있는 P3e는 "**3개 디커플링 → 구 클러스터 전체 제거**" 하나뿐이다. (사용자 승인: 2026-06-02.)

## 잠긴 결정 (P3a 계획 D1–D7 적용)

- **D1**(details 검증 SSOT = `semantics.validateDetails`): Task 3에서 make-error를 catalog `validateDetails`로 옮기고 zod `schema.ts` 의존 제거 → Task 6에서 schema.ts 삭제.
- **D2**(멤버십 가드 = 정적 frozen code-set): 이미 `decision/codes.ts` `KNOWN_ERROR_CODES`로 구현됨. Task 1이 그 SSOT를 registry→catalog로 옮김.
- **D6**(컴파일타임 allowlist 보장 상실 = Known Limitation): Task 4 catalog-invariants는 allowlist 키가 비어있지 않은 문자열인지 경량 체크만.
- **D7**(registry.ts 삭제 + SEC-4 shallow pick 유지): Task 6에서 registry.ts 삭제. `pickAllowlistedDetails` shallow는 `decision/system.ts`에 이미 있고 본 계획은 건드리지 않음.

## P3e 이후 다운스트림 영향 (예상·정상)

- **error-adapters(P6)**: `sentry-reporter.ts`/`sonner-presenter.ts`/`pager-notifier.ts`가 구 sink(`Reporter`/`Presenter`/`Notifier`/`DomainError`/`Severity`/`LogLevel`/`isExpectedCode`/registry `ErrorCode`)를 import. **3개 전부 red가 된다**(sentry-reporter는 P3c 이후 green이었으나 P3e로 red — 유일한 가시 회귀, P6가 `ReporterSink`/`NotifierSink`로 재배선하며 해소).
- **error-next(P5)**: `query-client`/`use-error-handler`/`raise`/`registry-context`/`safe-*`/`request-handler.server`/`ErrorHandlerInit`/`ErrorFallback`가 삭제 심볼 import — 이미 red, P5에서 신 표면 채택.
- **apps(P8)**: `error-architecture`의 `actions.ts`(isDomainError) 등 — 이미 red, P8에서 도그푸딩 마이그레이션.
- **데드맨 스위치(dead-man's-switch)**: 구 `guardedCompositeReporter`(telemetry-dead-mans-switch)는 본 단계에서 삭제된다. RFC §8.4는 이 불변식을 error-core에 보존하라고 한다 → **P6/P7에서 `ReporterSink` 위에 재도입**(Task 6의 decision-log 노트에 기록).

---

## 파일 구조 (변경 요약)

| 파일 | 동작 | 책임 |
| --- | --- | --- |
| `decision/codes.ts` | Modify (T1) | ErrorCode/KNOWN_ERROR_CODES SSOT를 catalog에서 파생 |
| `translator.ts` | Modify (T2) | KEY_TO_CODE/FALLBACK_MESSAGES 타입을 catalog/codes 기반으로 |
| `make-error.ts` | Modify (T3) | 상세 검증을 catalog `validateDetails`로(D1), zod 제거 |
| `__tests__/registry-invariants.test.ts` | Delete (T4) | → `catalog-invariants.test.ts`로 대체 |
| `__tests__/catalog-invariants.test.ts` | Create (T4) | 통합 catalog 데이터 무결성 불변식 |
| `telemetry.ts` | Delete (T5) | 구 Reporter/Presenter (dead) |
| `notifier.ts` | Delete (T5) | 구 Notifier/AlertPolicy (dead) |
| `adapters/console-reporter.ts` | Delete (T5) | 구 Reporter 구현 (dead) |
| `adapters/composite.ts` | Delete (T5) | 구 Reporter composite/dead-man's-switch (dead) |
| `__tests__/composite.test.ts` | Delete (T5) | 구 composite 테스트 |
| `index.ts` | Modify (T5, T6) | 배럴에서 구 export 제거 |
| `app-error.ts` | Delete (T6) | 구 DomainError 클러스터 keystone |
| `active-registry.ts` | Delete (T6) | ALS 격리 (제거 결정 D2) |
| `registry.ts` | Delete (T6) | flat ErrorMeta/DEFAULT_ERROR_REGISTRY |
| `schema.ts` | Delete (T6) | zod ErrorDetailsSchema (D1) |
| `policy.ts` | Delete (T6) | 구 정책 축 타입 |
| `severity.ts` | Delete (T6) | 구 Severity 타입 |
| `__tests__/per-request-isolation.test.ts` | Delete (T6) | ALS 격리 테스트 |
| (불변) `runtime.ts` | Keep | `getRuntime`은 make-error가 계속 사용 — 구 클러스터 아님 |

---

### Task 1: `decision/codes.ts` — 코드 SSOT를 catalog에서 파생 (① 엣지 컷)

**Files:**
- Modify: `packages/error-core/src/decision/codes.ts`
- Test: `packages/error-core/src/__tests__/decision-vocabulary.test.ts`

순환 import 안전: `codes.ts`→`catalog.ts`(value), `catalog.ts`→`types.ts`(type-only), `types.ts`→`app-error.ts`(type-only), `app-error.ts`→`codes.ts`(value, **호출은 런타임에만** — module-eval 시 catalog 리터럴만 필요). value 사이클 없음.

- [ ] **Step 1: 특성화 테스트 추가** — `decision-vocabulary.test.ts`에 codes SSOT가 정확히 15코드이고 catalog와 1:1임을 고정하는 테스트를 추가(이미 유사 단언이 있으면 강화). 파일 상단 import에 다음이 있는지 확인하고 없으면 추가: `import { KNOWN_ERROR_CODES, isKnownErrorCode } from "@/error/decision/codes";` `import { CANONICAL_ERROR_SEMANTICS } from "@/error/decision/catalog";`

```ts
describe("error code SSOT (P3e: catalog-derived)", () => {
  it("KNOWN_ERROR_CODES is exactly the catalog keys (15)", () => {
    expect([...KNOWN_ERROR_CODES].sort()).toEqual(Object.keys(CANONICAL_ERROR_SEMANTICS).sort());
    expect(KNOWN_ERROR_CODES.size).toBe(15);
  });
  it("isKnownErrorCode narrows known vs unknown", () => {
    expect(isKnownErrorCode("VALIDATION")).toBe(true);
    expect(isKnownErrorCode("RATE_LIMITED")).toBe(true);
    expect(isKnownErrorCode("NOPE_NOT_A_CODE")).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트 실행(현 구현에서 통과 확인 — registry/catalog 동치이므로 green)**

Run: `pnpm --filter error-core test -- decision-vocabulary`
Expected: PASS (registry와 catalog 코드 집합이 동일하므로 현재도 green) — 이 테스트가 이제 회귀 가드가 된다.

- [ ] **Step 3: `decision/codes.ts`를 catalog 파생으로 재작성** (전체 내용)

```ts
// error-core/decision/codes.ts — 알려진 에러 코드 SSOT. 정본 = 통합 카탈로그(CANONICAL_ERROR_SEMANTICS).
// (P3e: DEFAULT_ERROR_REGISTRY 의존 제거 — registry.ts는 Task 6에서 삭제된다.)
import { CANONICAL_ERROR_SEMANTICS } from "./catalog";

export type ErrorCode = keyof typeof CANONICAL_ERROR_SEMANTICS;
export const KNOWN_ERROR_CODES: ReadonlySet<string> = new Set(Object.keys(CANONICAL_ERROR_SEMANTICS));
export const isKnownErrorCode = (code: string): code is ErrorCode => KNOWN_ERROR_CODES.has(code);
```

- [ ] **Step 4: 게이트 실행**

Run: `pnpm --filter error-core typecheck && pnpm --filter error-core test`
Expected: PASS (319 tests + 추가분). `ErrorCode`가 `keyof typeof CANONICAL_ERROR_SEMANTICS`로 동일 15코드 union이므로 타입 변화 없음.

- [ ] **Step 5: 엣지 컷 확인 + 커밋**

Run: `grep -n "registry" packages/error-core/src/decision/codes.ts` → Expected: 히트 없음(주석 포함 0).

```bash
git add packages/error-core/src/decision/codes.ts packages/error-core/src/__tests__/decision-vocabulary.test.ts
git commit -m "refactor(error-core): derive ErrorCode SSOT from catalog, drop registry edge (P3e ①)"
```

---

### Task 2: `translator.ts` — KEY_TO_CODE/FALLBACK 타입을 catalog/codes 기반으로 (② 엣지 컷)

**Files:**
- Modify: `packages/error-core/src/translator.ts`
- Test: `packages/error-core/src/__tests__/i18n-completeness.test.ts`

근거: catalog의 `defaultMessageKey`는 registry의 `userMessageKey`와 15코드 전부 값이 동일(`error.validation`/`error.invalidCredentials`/…). 따라서 KEY_TO_CODE 역인덱스는 동일하게 빌드된다. `FALLBACK_MESSAGES`(Korean 컬럼)는 값 불변, 타입만 `ErrorCode`(codes) 기준.

- [ ] **Step 1: 회귀 가드 확인** — `i18n-completeness.test.ts`는 `resolveErrorMessage`(host translator → fallback → generic, RATE_LIMITED `{seconds}` 보간, key-echo 거부)를 검증한다. 현재 green. 이 테스트가 가드다. 추가 작업 없음(단, 이 테스트가 `DEFAULT_ERROR_REGISTRY`를 import해 키를 교차검증한다면 Step 3에서 `CANONICAL_ERROR_SEMANTICS`로 re-point — 파일을 열어 확인할 것).

- [ ] **Step 2: 기준선 실행**

Run: `pnpm --filter error-core test -- i18n-completeness`
Expected: PASS (기준선).

- [ ] **Step 3: `translator.ts` import + KEY_TO_CODE + FALLBACK_MESSAGES 타입 변경**

import 교체 (현재 13-14행):
```ts
// 변경 전:
//   import type { ErrorCode } from "./registry";
//   import { DEFAULT_ERROR_REGISTRY } from "./registry";
// 변경 후:
import type { ErrorCode } from "./decision/codes";
import { CANONICAL_ERROR_SEMANTICS } from "./decision/catalog";
```

`FALLBACK_MESSAGES`의 `satisfies` 절(현재 47행)은 그대로 `as const satisfies Record<ErrorCode, string>` 유지(이제 ErrorCode는 codes 출처 — 동일 15코드).

KEY_TO_CODE(현재 52-60행)를 catalog 기반으로:
```ts
/** Reverse index: defaultMessageKey string → ErrorCode. Built once from the canonical catalog. */
const KEY_TO_CODE: Readonly<Record<string, ErrorCode>> = Object.freeze(
  (Object.keys(CANONICAL_ERROR_SEMANTICS) as ErrorCode[]).reduce<Record<string, ErrorCode>>(
    (acc, code) => {
      acc[CANONICAL_ERROR_SEMANTICS[code].defaultMessageKey] = code;
      return acc;
    },
    {},
  ),
);
```

(주석 8-13행의 "per-locale nested FALLBACK_MESSAGES … registry" 언급은 stale하지 않음 — registry 단어만 빼고 흐름 유지하거나 그대로 둬도 무방. 코드 정확성에는 영향 없음.)

- [ ] **Step 4: 게이트 실행**

Run: `pnpm --filter error-core typecheck && pnpm --filter error-core test`
Expected: PASS. RATE_LIMITED `{seconds}` 보간/ key-echo 거부 테스트 green 유지.

- [ ] **Step 5: 엣지 컷 확인 + 커밋**

Run: `grep -n "from \"./registry\"\|DEFAULT_ERROR_REGISTRY" packages/error-core/src/translator.ts` → Expected: 히트 없음.

```bash
git add packages/error-core/src/translator.ts packages/error-core/src/__tests__/i18n-completeness.test.ts
git commit -m "refactor(error-core): translator KEY_TO_CODE from catalog defaultMessageKey, drop registry edge (P3e ②)"
```

---

### Task 3: `make-error.ts` — 상세 검증을 catalog `validateDetails`로 (③ 엣지 컷, D1)

**Files:**
- Modify: `packages/error-core/src/make-error.ts`
- Test: `packages/error-core/src/__tests__/make-error.test.ts`

근거/안전: 커널에서 `makeError`의 유일 호출자는 `normalize.ts`이며 **항상 `details: null`**로 호출한다(branch 3b/4의 UNKNOWN_*, mapKnownError의 REQUEST_ABORTED/OFFLINE/NETWORK_ERROR/TIMEOUT). null은 어떤 코드든 valid이므로 live 경로 동작은 불변. 풍부한 details 검증은 make-error.test.ts만 직접 행사한다. 그 테스트는 전부 `VALIDATION`(catalog에 `validateDetails` 보유)으로 invalid 케이스를 만들므로 **동작이 보존**된다.

- [ ] **Step 1: 테스트 의도 확인(코드 변경 없음)** — `make-error.test.ts`를 열어 다음을 확인:
  - "valid details pass through"(`VALIDATION` `{fieldErrors:{email:["required"]}}`) → validateDetails(VALIDATION) true → 통과.
  - "accepts z.null() code with null"(`AUTH_REQUIRED` null) → AUTH_REQUIRED엔 validateDetails 없음 → 통과(accept).
  - invalid → UNKNOWN_* (`VALIDATION` `"not-a-valid-shape"`/`123`/`{wrong:true}`/`undefined`/`{whoops:"bad"}`) → validateDetails(VALIDATION) false → fallback. runtime 분기/ correlationId/ cause/ message 동작 보존.
  - "NOT_FOUND `{resource:"user"}`" 성공 경로는 details를 단언하지 않음 → 무영향.

- [ ] **Step 2: 기준선 실행**

Run: `pnpm --filter error-core test -- make-error`
Expected: PASS (9 tests, 기준선).

- [ ] **Step 3: `make-error.ts` 재작성** (전체 내용)

```ts
// error-core/make-error.ts — produces an AppError (decision model). 상세 검증은 카탈로그의
// per-code validateDetails(D1)로 게이트한다(zod 아님). validateDetails가 없는 코드는 느슨히 수용
// (D1: 검증 깊이 상실 수용 — 최종 보안 게이트는 finalize 시 system.finalize* + 누출게이트).
import { CANONICAL_ERROR_SEMANTICS } from "./decision/catalog";
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
  const semantics = CANONICAL_ERROR_SEMANTICS[opts.code as keyof typeof CANONICAL_ERROR_SEMANTICS];
  const detailsValid = semantics?.validateDetails ? semantics.validateDetails(opts.details) : true;
  if (!detailsValid) {
    // 여기 도달은 그 자체로 비정상 — 설계상 프로그래머 실수.
    return appError(unknownCodeForRuntime(), null, {
      message: opts.message ?? "알 수 없는 오류가 발생했습니다.",
      cause: opts.cause ?? opts.details,
      correlationId: opts.correlationId,
      digest: opts.digest,
    });
  }
  return appError(opts.code, opts.details ?? null, {
    message: opts.message,
    cause: opts.cause,
    correlationId: opts.correlationId,
    retryAfterMs: opts.retryAfterMs,
    userCanRetry: opts.userCanRetry,
    digest: opts.digest,
  });
};
```

- [ ] **Step 4: make-error.test.ts 주석 갱신(코드 무변경)** — 파일 상단 주석(1-4행)의 "app-error's getActiveErrorRegistry, which also reads getRuntime" 문구는 stale. 다음으로 교체:

```ts
// §10 — makeError validation & runtime-driven UNKNOWN_* fallback.
// @/error/runtime을 목해 getRuntime()을 결정적으로 만든다: makeError의 unknownCodeForRuntime()이
// 이 단일 목을 통해 라우팅된다. (P3e: 상세 검증은 catalog validateDetails로 이동; 구 zod schema 제거.)
```

- [ ] **Step 5: 게이트 실행**

Run: `pnpm --filter error-core typecheck && pnpm --filter error-core test`
Expected: PASS. make-error 9 tests green(동작 보존).

- [ ] **Step 6: 엣지 컷 확인 + 커밋**

Run: `grep -rn "from \"./schema\"\|ErrorDetailsSchema" packages/error-core/src/make-error.ts` → Expected: 히트 없음.

```bash
git add packages/error-core/src/make-error.ts packages/error-core/src/__tests__/make-error.test.ts
git commit -m "refactor(error-core): make-error validates via catalog validateDetails (D1), drop zod schema edge (P3e ③)"
```

---

### Task 4: `registry-invariants.test.ts` → `catalog-invariants.test.ts` 재작성

**Files:**
- Create: `packages/error-core/src/__tests__/catalog-invariants.test.ts`
- Delete: `packages/error-core/src/__tests__/registry-invariants.test.ts`

근거: 구 `registry-invariants.test.ts`는 `DEFAULT_ERROR_REGISTRY`/`ErrorDetailsSchema`/`isExpectedCode`/구 정책 축(kind/present/severity/log/zod shape)에 결합 — 전부 Task 6에서 삭제. 그 데이터 무결성 의도를 **통합 catalog**(`CANONICAL_ERROR_SEMANTICS`)에 대해 재표현한다. 삭제될 개념(present/log/severity 매트릭스, zod shape, isExpectedCode)은 신 모델 등가물(category, detailsAllowlist, category==='business')로 대체.

- [ ] **Step 1: 새 테스트 파일 작성** `packages/error-core/src/__tests__/catalog-invariants.test.ts` (전체 내용)

```ts
// §10 — 통합 catalog 불변식 (P3e: 구 registry-invariants 대체).
// CANONICAL_ERROR_SEMANTICS(통합 정적 카탈로그)의 데이터 무결성을 테이블 구동으로 고정한다.
// 구 ErrorMeta(kind/present/log/severity/zod) 축은 신 ErrorSemantics(category/sensitivity/
// detailsExposure/validateDetails)로 대체됐다.
import { describe, it, expect } from "vitest";
import { CANONICAL_ERROR_SEMANTICS } from "@/error/decision/catalog";
import { KNOWN_ERROR_CODES, type ErrorCode } from "@/error/decision/codes";
import { validateCatalog } from "@/error/decision/validate";

const CODES = Object.keys(CANONICAL_ERROR_SEMANTICS) as ErrorCode[];

const CATEGORIES = ["business", "operational", "fault"] as const;
const SENSITIVITIES = ["public", "auth", "permission", "pii", "business-sensitive", "internal"] as const;

// 구 expected:true 집합 — 이제 category === "business".
const BUSINESS_CODES = [
  "VALIDATION",
  "INVALID_CREDENTIALS",
  "AUTH_REQUIRED",
  "FORBIDDEN",
  "NOT_FOUND",
] as const satisfies ReadonlyArray<ErrorCode>;

describe("§10 catalog invariants (P3e)", () => {
  it("catalog exposes the documented 15 codes and matches KNOWN_ERROR_CODES", () => {
    expect(CODES.length).toBe(15);
    expect([...KNOWN_ERROR_CODES].sort()).toEqual([...CODES].sort());
  });

  it("each entry's `code` field equals its catalog key (no drift)", () => {
    for (const code of CODES) {
      expect(CANONICAL_ERROR_SEMANTICS[code].code).toBe(code);
    }
  });

  describe.each(CODES)("code %s", (code) => {
    const s = CANONICAL_ERROR_SEMANTICS[code];

    it("category / sensitivity are members of their unions", () => {
      expect(CATEGORIES).toContain(s.category);
      expect(SENSITIVITIES).toContain(s.sensitivity);
    });

    it("defaultHttpStatus is a sensible HTTP status", () => {
      expect(s.defaultHttpStatus).toBeGreaterThanOrEqual(400);
      expect(s.defaultHttpStatus).toBeLessThan(600);
    });

    it("defaultMessageKey is a non-empty i18n key", () => {
      expect(typeof s.defaultMessageKey).toBe("string");
      expect(s.defaultMessageKey.length).toBeGreaterThan(0);
    });

    it("defaultRetryable is a boolean", () => {
      expect(typeof s.defaultRetryable).toBe("boolean");
    });

    // D6: allowlist 노출 코드는 비어있지 않은 문자열 키 배열을 가져야 한다.
    it("detailsExposure rule is well-formed (allowlist ⇒ non-empty string keys; none ⇒ no allowlist leak)", () => {
      if (s.detailsExposure === "allowlist") {
        expect(Array.isArray(s.detailsAllowlist)).toBe(true);
        expect(s.detailsAllowlist!.length).toBeGreaterThan(0);
        for (const key of s.detailsAllowlist!) {
          expect(typeof key).toBe("string");
          expect(key.length).toBeGreaterThan(0);
        }
      } else {
        expect(s.detailsExposure).toBe("none");
        // none 코드는 노출할 키가 없어야 한다(누출 표면 0).
        expect(s.detailsAllowlist ?? []).toHaveLength(0);
      }
    });
  });

  it("the business set is EXACTLY the five business-category codes", () => {
    const businessByCategory = CODES.filter((c) => CANONICAL_ERROR_SEMANTICS[c].category === "business");
    expect(businessByCategory.sort()).toEqual([...BUSINESS_CODES].sort());
  });

  it("UNKNOWN_SERVER_ERROR and UNKNOWN_CLIENT_ERROR are fault", () => {
    expect(CANONICAL_ERROR_SEMANTICS.UNKNOWN_SERVER_ERROR.category).toBe("fault");
    expect(CANONICAL_ERROR_SEMANTICS.UNKNOWN_CLIENT_ERROR.category).toBe("fault");
  });

  it("RATE_LIMITED is 429, retryable, and exposes retryAfterMs through the allowlist", () => {
    const s = CANONICAL_ERROR_SEMANTICS.RATE_LIMITED;
    expect(s.defaultHttpStatus).toBe(429);
    expect(s.defaultRetryable).toBe(true);
    expect(s.detailsExposure).toBe("allowlist");
    expect(s.detailsAllowlist).toContain("retryAfterMs");
    // validateDetails는 retryAfterMs:number를 요구한다(D1).
    expect(s.validateDetails?.({ retryAfterMs: 1000 })).toBe(true);
    expect(s.validateDetails?.({ retryAfterMs: "soon" })).toBe(false);
  });

  it("VALIDATION exposes fieldErrors and validates its shape (D1)", () => {
    const s = CANONICAL_ERROR_SEMANTICS.VALIDATION;
    expect(s.detailsExposure).toBe("allowlist");
    expect(s.detailsAllowlist).toEqual(["fieldErrors"]);
    expect(s.validateDetails?.({ fieldErrors: { email: ["required"] } })).toBe(true);
    expect(s.validateDetails?.("nope")).toBe(false);
    expect(s.validateDetails?.(null)).toBe(false);
  });

  it("validateCatalog passes for the canonical catalog (disclosure/messageKey invariant holds)", () => {
    expect(() => validateCatalog(CANONICAL_ERROR_SEMANTICS, "UNKNOWN_SERVER_ERROR")).not.toThrow();
  });
});
```

- [ ] **Step 2: 구 테스트 삭제**

```bash
git rm packages/error-core/src/__tests__/registry-invariants.test.ts
```

- [ ] **Step 3: 게이트 실행**

Run: `pnpm --filter error-core typecheck && pnpm --filter error-core test`
Expected: PASS. 새 `catalog-invariants` 통과, registry-invariants 제거됨. (registry.ts/schema.ts는 아직 존재 — 다른 소비자(구 app-error 등)가 Task 6 전까지 살려둠.)

- [ ] **Step 4: 커밋**

```bash
git add packages/error-core/src/__tests__/catalog-invariants.test.ts
git commit -m "test(error-core): replace registry-invariants with catalog-invariants (P3e)"
```

---

### Task 5: 구 sink 삭제 (telemetry/notifier/console-reporter/composite) + 배럴 정리

**Files:**
- Delete: `packages/error-core/src/telemetry.ts`
- Delete: `packages/error-core/src/notifier.ts`
- Delete: `packages/error-core/src/adapters/console-reporter.ts`
- Delete: `packages/error-core/src/adapters/composite.ts`
- Delete: `packages/error-core/src/__tests__/composite.test.ts`
- Modify: `packages/error-core/src/index.ts` (배럴 telemetry/notifier/composite/console-reporter export 제거)

사전 확인: 신 경로는 `decision/types.ts`의 `ReporterSink`/`NotifierSink`만 쓴다. `handle-error.ts`/`handler.ts`/`types.ts`/`decision/system.ts`는 구 `Reporter`/`Presenter`/`Notifier`를 import하지 않는다(검증됨). 구 sink의 유일 커널 소비자는 배럴 + composite.test.ts뿐. `adapters/` 디렉터리는 이 둘만 들어있으므로 비게 된다.

- [ ] **Step 1: 구 sink 파일 + 테스트 삭제**

```bash
git rm packages/error-core/src/telemetry.ts \
       packages/error-core/src/notifier.ts \
       packages/error-core/src/adapters/console-reporter.ts \
       packages/error-core/src/adapters/composite.ts \
       packages/error-core/src/__tests__/composite.test.ts
```

- [ ] **Step 2: 배럴(`index.ts`)에서 구 sink export 제거** — 현재 58-83행 블록을 다음으로 교체(텔레메트리 섹션을 신 모델만 남김):

```ts
// ── 텔레메트리 계약 + 단일 처리 경로 (컴포지션 루트/어댑터용) ───────────────
// (TelemetryContext/ReporterSink/NotifierSink/TelemetryDecision 등은 `export * from "./decision"`로 노출)
export type { HandleErrorDeps } from "./types";
export { createHandleError, type HandleErrorOptions } from "./handle-error";
```

즉 다음 export들을 **삭제**한다:
- `export type { Reporter, Presenter, TelemetryContext } from "./telemetry";` (Reporter/Presenter 삭제; TelemetryContext는 decision/types에서 star로 옴 → 명시 제거)
- `noopNotifier, compositeNotifier, policyGatedNotifier, thresholdAlertPolicy, compareSeverity, type Notifier, type AlertPolicy, type ThresholdPolicyOptions` (`from "./notifier"` 블록 전체)
- `guardedCompositeReporter, compositeReporter, noopReporter, type GuardedCompositeReporter, type ReporterHealth, type LabeledReporter, type CompositeReporterOptions` (`from "./adapters/composite"` 블록 전체)
- `createConsoleReporter` (`from "./adapters/console-reporter"`)

`export type { HandleErrorDeps } from "./types";`와 `export { createHandleError, type HandleErrorOptions } from "./handle-error";`는 **유지**(신 모델).

- [ ] **Step 3: 게이트 실행**

Run: `pnpm --filter error-core typecheck && pnpm --filter error-core test`
Expected: PASS. (severity.ts/policy.ts는 아직 app-error/registry가 import하므로 존재 — Task 6에서 삭제.) `adapters/` 디렉터리가 비었는지 확인: `ls packages/error-core/src/adapters` → Expected: 빈 디렉터리(없으면 `git rm`이 정리). 비었으면 `rmdir packages/error-core/src/adapters` (git은 빈 디렉터리 추적 안 함 — 무시 가능).

- [ ] **Step 4: 커밋**

```bash
git add -A packages/error-core/src/index.ts packages/error-core/src/telemetry.ts packages/error-core/src/notifier.ts packages/error-core/src/adapters packages/error-core/src/__tests__/composite.test.ts
git commit -m "feat(error-core)!: delete legacy sinks (Reporter/Presenter/Notifier/composite/console), unify on decision ReporterSink/NotifierSink (P3e)"
```

> **P6/P7 노트(Task 6 decision-log에 기록):** 구 `guardedCompositeReporter`의 dead-man's-switch(telemetry-dead-mans-switch, RFC §8.4 보존 대상)는 본 단계에서 제거됐다. P6/P7에서 신 `ReporterSink` 위에 재도입한다.

---

### Task 6: 구 코어 삭제 (app-error/active-registry/registry/schema/policy/severity) + 배럴 최종 정리 + green 봉인

**Files:**
- Delete: `packages/error-core/src/app-error.ts`
- Delete: `packages/error-core/src/active-registry.ts`
- Delete: `packages/error-core/src/registry.ts`
- Delete: `packages/error-core/src/schema.ts`
- Delete: `packages/error-core/src/policy.ts`
- Delete: `packages/error-core/src/severity.ts`
- Delete: `packages/error-core/src/__tests__/per-request-isolation.test.ts`
- Modify: `packages/error-core/src/index.ts` (배럴 구 코어 export 제거)

사전 확인: Task 1–5 후 구 코어의 live 커널 importer는 0이어야 한다. 단, **테스트가 구 심볼을 import할 수 있다** — Step 1에서 grep으로 전수 확인 후 마이그레이션/삭제한다.

- [ ] **Step 1: 잔여 구-심볼 importer 전수 확인 (grep 게이트)**

Run:
```bash
grep -rn "from \"\.\?\./app-error\"\|from \"@/error/app-error\"\|active-registry\|from \"\.\?\./registry\"\|from \"@/error/registry\"\|from \"\.\?\./schema\"\|from \"@/error/schema\"\|from \"\.\?\./policy\"\|from \"\.\?\./severity\"\|DomainError\|resolvePolicy\|ResolvedPolicy\|ResolvedAppError\|isExpectedCode\|getActiveErrorRegistry\|setActiveErrorRegistry\|runWithErrorRegistry\|ErrorDetailsSchema\|ErrorDetailsMap\|DEFAULT_ERROR_REGISTRY\|ErrorMeta\|ErrorRegistry" packages/error-core/src --include="*.ts" | grep -v "src/app-error.ts\|src/active-registry.ts\|src/registry.ts\|src/schema.ts\|src/policy.ts\|src/severity.ts"
```
Expected(이상): 비-삭제 소스 파일에서 히트 0. **만약 테스트(예: `app-error-puredata.test.ts`, `rehydration.test.ts`, `network-boundary.test.ts`, `field-errors.test.ts`)에 히트가 있으면**:
  - `DomainError`가 **문자열/이름 interop**(`isAppError`가 `name==="DomainError"` 수용)을 검증하는 단언이면 → 유지(신 `decision/app-error.ts`의 isAppError가 그 이름을 계속 수용).
  - 구 심볼을 **import**하는 것이면 → 신 등가물로 re-point: `@/error/app-error` → `@/error/decision/app-error`(AppError/appError/isAppError/SerializedError/isSerializedError/fromSerialized), `@/error/registry` ErrorCode → `@/error/decision/codes`, `DEFAULT_ERROR_REGISTRY` 교차검증 → `CANONICAL_ERROR_SEMANTICS`.
  - 구 개념 전용 단언(resolvePolicy/getActiveErrorRegistry/ErrorDetailsSchema)이면 → 해당 단언 제거 또는 신 모델 등가물로 대체.

각 수정은 그 테스트가 green 유지하도록.

- [ ] **Step 2: `per-request-isolation.test.ts` 삭제** (ALS 격리 테스트 — D2로 active-registry 제거됨)

```bash
git rm packages/error-core/src/__tests__/per-request-isolation.test.ts
```

- [ ] **Step 3: 구 코어 6개 파일 삭제**

```bash
git rm packages/error-core/src/app-error.ts \
       packages/error-core/src/active-registry.ts \
       packages/error-core/src/registry.ts \
       packages/error-core/src/schema.ts \
       packages/error-core/src/policy.ts \
       packages/error-core/src/severity.ts
```

- [ ] **Step 4: 배럴(`index.ts`) 최종 정리** — 현재 9-36행(에러 모델/식별 + 레지스트리/스키마/어휘 블록)을 다음으로 교체:

```ts
// ── 에러 모델 + 식별 ────────────────────────────────────────────────────────
// 통합 모델(AppError 클래스·appError·isAppError·SerializedError·isSerializedError·
// ClientErrorPayload·isClientErrorPayload·ErrorCode·KNOWN_ERROR_CODES·isKnownErrorCode·
// CANONICAL_ERROR_SEMANTICS 등)은 전부 `export * from "./decision"`로 노출된다(파일 하단).
export { makeError, unknownCodeForRuntime } from "./make-error";

// ── 런타임 감지 ─────────────────────────────────────────────────────────────
export { getRuntime, type Runtime } from "./runtime";
```

즉 다음 명시 export 블록들을 **전부 삭제**한다:
- `from "./app-error"` 블록(DomainError/isDomainError/isSerializedError/isClientSerializedError/isExpectedCode/resolvePolicy/AppError(type)/AppErrorOptions/SerializedError/ClientSerializedError/ResolvedPolicy/ResolvedAppError) — 11-24행.
  - 신 등가물(AppError 클래스/AppErrorOptions/SerializedError/isSerializedError 등)은 `export * from "./decision"`로 이미 노출되므로 명시 줄 제거만 하면 신 심볼이 정본이 된다. 구 전용(DomainError/isDomainError/isClientSerializedError/isExpectedCode/resolvePolicy/ResolvedPolicy/ResolvedAppError/ClientSerializedError)은 등가물 없이 제거 — 소비자(P5/P6/P8, red)가 신 표면(AppError/isAppError/isClientErrorPayload/category)을 채택한다.
- `from "./registry"`(DEFAULT_ERROR_REGISTRY/ErrorCode/ErrorMeta/ErrorRegistry) — 27행. ErrorCode는 decision/codes에서 star로 노출.
- `from "./schema"`(ErrorDetailsSchema/ErrorDetailsMap) — 28행. 제거(등가물 없음, D1).
- `from "./severity"`(Severity) — 29행. 제거.
- `from "./policy"`(PresentAction/LogLevel/HttpStatus/ErrorKind) — 30행. 제거(신 모델은 decision/types의 UserAction/ErrorSurface/ErrorCategory/TelemetryDecision.level).
- `from "./active-registry"`(getActiveErrorRegistry/setActiveErrorRegistry/runWithErrorRegistry) — 32-36행. 제거.

`getRuntime/Runtime`(31행, runtime.ts — 구 클러스터 아님, make-error가 사용)은 **유지**.

- [ ] **Step 5: 최종 게이트 + 누출 게이트 불변식 확인**

Run: `pnpm --filter error-core typecheck && pnpm --filter error-core test`
Expected: PASS. 누출 게이트(`serialize-client.test.ts` 또는 이전된 테스트 — 15코드 검증)·rehydration·network-boundary·route-handler·decision-* 전부 green.

- [ ] **Step 6: 사후 grep 게이트 (커널에 구 스택 잔재 0)**

Run:
```bash
echo "삭제 파일 잔존:"; ls packages/error-core/src/{app-error,active-registry,registry,schema,policy,severity,telemetry,notifier}.ts packages/error-core/src/adapters/*.ts 2>&1 | grep -v "No such file" || echo "  (모두 삭제됨 ✓)"
echo "구 심볼 잔여 참조:"; grep -rn "DomainError\b\|resolvePolicy\|getActiveErrorRegistry\|ErrorDetailsSchema\|DEFAULT_ERROR_REGISTRY\|\bErrorMeta\b\|\bReporter\b\|\bPresenter\b\|\bNotifier\b" packages/error-core/src --include="*.ts" | grep -v "ReporterSink\|NotifierSink\|name === \"DomainError\"\|legacy/cross-package interop\|interop" || echo "  (잔여 0 ✓)"
```
Expected: 삭제 파일 모두 없음. 구 심볼 잔여 0(단 `decision/app-error.ts`의 `isAppError` interop 주석/`name==="DomainError"` 수용 라인은 의도적 — 제외됨).

- [ ] **Step 7: 다운스트림 red 상태 문서화(확인만)**

Run(정보용, 실패 무시): `pnpm --filter error-adapters typecheck 2>&1 | tail -5; pnpm --filter error-next typecheck 2>&1 | tail -5`
Expected: error-adapters/error-next red(삭제 심볼 미존재). **이는 정상** — P6/P5에서 신 표면 채택으로 해소. error-core만 게이트.

- [ ] **Step 8: 커밋**

```bash
git add -A packages/error-core/src
git commit -m "feat(error-core)!: delete legacy core (DomainError/active-registry/registry/schema/policy/severity); kernel now decision-model only (P3e)"
```

---

## Self-Review

**1. Spec coverage (P3a 계획 §P3e + RFC §2.2/§9 P3e):**
- "active-registry.ts 삭제" → Task 6. ✓
- "구 app-error DomainError/getter/resolvePolicy/ResolvedPolicy/ResolvedAppError/isExpectedCode/구 guards/ClientSerializedError 삭제" → Task 6. ✓
- "registry.ts(ErrorMeta/DEFAULT_ERROR_REGISTRY) 삭제, ErrorCode는 codes.ts로" → Task 1(codes 정본화) + Task 6(삭제). ✓
- "schema.ts(D1) 삭제 — make-error를 validateDetails로 선행" → Task 3 + Task 6. ✓
- "policy.ts/severity.ts grep 후 삭제" → Task 6 Step 1 grep + Step 3. ✓
- "배럴 정리" → Task 5 + Task 6. ✓
- "per-request-isolation.test.ts 삭제, registry-invariants.test.ts 재앵커" → Task 6(삭제) + Task 4(재앵커). ✓
- "grep 게이트로 live importer 0 확인 후 삭제" → Task 6 Step 1/6. ✓
- "크로스패키지 break는 kernel-only — error-core만 per-package green" → 게이트 정의 + Task 6 Step 7. ✓
- 구 sink(telemetry/notifier/console-reporter/composite) — keystone 얽힘으로 P3e에 흡수(핸드오프 "P6 보류"가 실현 불가임을 배경에 문서화) → Task 5. ✓
- RFC §2.2 "구 resolvePolicy/flat ErrorMeta 제거", "AsyncLocalStorage 제거" → Task 6. ✓

**2. Placeholder scan:** 모든 코드 step에 완전한 코드 또는 정확한 grep/명령 + 기대값 포함. 테스트 마이그레이션(Task 6 Step 1)은 "열어서 확인 후 분기 규칙"을 명시(실제 파일 의존 — 구현자가 grep 결과로 결정).

**3. Type consistency:** `ErrorCode`(Task 1: `keyof typeof CANONICAL_ERROR_SEMANTICS`)는 Task 2(translator)/Task 3(make-error)/Task 4(test)에서 동일 출처(`decision/codes`)로 import. `CANONICAL_ERROR_SEMANTICS[code].defaultMessageKey`(Task 2)·`.validateDetails`(Task 3)·`.category`/`.detailsAllowlist`(Task 4)는 모두 `decision/types.ts` `ErrorSemantics` 필드와 일치. `AppError`/`appError`(make-error, Task 3)는 `decision/app-error.ts` 시그니처(`appError<C>(code, details=null, options={})`)와 일치.

**4. 순환 import:** Task 1의 `codes.ts → catalog.ts`는 value import이나 catalog는 value 의존이 없어(type-only `ErrorCatalog`) 사이클 없음. module-eval 순서 안전(catalog 리터럴 먼저, codes Set 빌드, app-error의 isKnownErrorCode 호출은 런타임).

---

## Execution Handoff

이 작업의 표준 리듬: **subagent-driven** — Task별 fresh implementer subagent → 2단계 리뷰(spec-compliance → code-quality, 독립 subagent) → 필요시 fix subagent. 위험/포팅 무거우면 opus, 기계적이면 sonnet. 매 Task per-package green 게이트.
