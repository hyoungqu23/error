# Error System 수렴 — P3a (AppError + 결정 시스템 팩토리, 비파괴 착륙) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax. 구현 시 superpowers:test-driven-development(red→green→refactor)를 따른다.

**Goal:** 순수 데이터 `AppError` 클래스와 `createDecisionSystem` 팩토리(+`fail`/`ok`/`appError`/`finalize*`/`toClientErrorPayload`/`executeErrorDecision`/Result 모델)를 `error-core`에 **추가(additive)**로 착륙시킨다. 이미 grafted된 `decision/{resolve,validate,catalog,types}`에 연결하고, **구 `DomainError`/정책 getter/ALS는 그대로 둔다.** 끝나면 새 모델이 error-core 안에서 테스트로 보증되고, 구 스택과 모든 기존 테스트는 여전히 green.

**Architecture:** 새 모델은 `error-core/src/decision/` 서브모듈에 응집시킨다 — `decision/app-error.ts`(순수 데이터 `AppError`), `decision/system.ts`(EDS `createDecisionSystem` 팩토리 코어를 포팅하되 inlined resolve*/validateCatalog 중복은 삭제하고 `../decision/{resolve,validate}`를 호출), `decision/types.ts`에 `ClientErrorPayload`·`messageVars`·`ReporterSink/NotifierSink` 추가. 구 `app-error.ts`/`registry.ts`/`serialize-client.ts` 등은 **무수정**(P3b–P3e에서 컷오버·삭제). `AppError`는 `decision/resolve.ts`의 구조적 `DecisionError`(`{code,retryAfterMs?,userCanRetry?,details?}`)를 구조적으로 만족하므로 어댑터 불필요.

**Tech Stack:** TypeScript 5.7, Vitest 2.1, pnpm + Turborepo. error-core는 zod 외 런타임 의존 없음(이 단계까지). 포팅 출처: `packages/error-decision-system/src/index.ts`.

**범위 주의 — 이건 P3(keystone) 5분할 중 첫 sub-plan(P3a)이다.**
- P3a = **추가만**(삭제·컷오버 없음). 새 `AppError`+팩토리가 구 `DomainError`와 **공존**. 이것이 P3b–P3e가 컷오버할 대상.
- P3b–P3e는 이 문서 마지막 "후속 단계 아웃라인"에 staged로 기술. **각 단계는 P3a 착륙 후 별도 계획으로 전개**(정확한 컷오버 코드는 P3a가 실현하는 시그니처에 의존).
- 근거 스펙: `docs/superpowers/specs/2026-06-02-error-system-convergence-design.md` §5.1/§5.3/§5.6/§5.7. 선행 완료: P0–P2(`decision/{types,catalog,validate,resolve}.ts`).

---

## 잠긴 결정 (7개 open decision — 기본값 + 근거)

> 이 결정들은 P3 전체에 적용된다. 가장 영향이 큰 **D1·D5**는 동의 안 하면 착수 전에 뒤집어야 함.

- **D1 — details 검증 SSOT:** **`semantics.validateDetails`(카탈로그)로 일원화**, P3e에서 zod `schema.ts`/`ErrorDetailsMap` 삭제. `AppError<C>`의 per-code details 타입은 `DetailsOf<Catalog,C>`로 도출. *근거:* 카탈로그를 단일 권위로(RFC §5.1), EDS가 이미 이 모델, 이중 검증 제거. *대가:* zod 런타임 구조 검증 깊이 상실 — rehydration fail-closed는 type-guard가 false면 UNKNOWN_* fallback으로 충분.
- **D2 — 멤버십 가드:** ALS 제거 후 `isSerializedError`/`isClientSerializedError`는 **`ErrorCode` SSOT에서 파생한 정적 frozen code-set**으로 코드 known 여부 확인. *근거:* static-catalog-only(RFC), 시그니처에 카탈로그 스레딩 불필요. (P3a에서 `decision/codes.ts`에 frozen set 노출 준비.)
- **D3 — actionFailure 계약:** `actionSuccess` 유지 + **`degrade(decisionResult): Result`** 헬퍼 신설(`DecisionFailure.payload`만 방출). 구 `actionFailure(AppError)`는 deprecate. *근거:* P5 error-next safe*가 `degrade()` 호출만 하면 되도록(기계적 스왑).
- **D4 — createHandleError 운명:** **재작성(유지)** — `resolveErrorDecision`+`executeErrorDecision`을 감싸고 `decision.telemetry`→sink 매핑. `HandleErrorOptions{present,log,severity}`는 5% occurrence/telemetry override escape hatch로 생존. *근거:* error-next per-request 핸들러 seam 보존 → P5 원활. (P3a는 시그니처만; 재배선은 P3d.)
- **D5 — messageVars 타이밍 + retryAfterMs 단일 소스:** 단일 소스 = **`AppError.retryAfterMs`(인스턴스 필드)**. RATE_LIMITED은 `details.retryAfterMs`도 allowlist shape 호환용으로 유지. `{seconds}` 보간은 **render-time(P4 error-react)** 도출 — wire 페이로드는 `retryAfterMs`를 싣고 `messageVars`는 카운트다운 케이스에서 미설정(렌더가 계산). *근거:* 똑딱이는 카운트다운 보존(현 sonner 동작). P3a는 `messageVars?` 필드 추가 + `retryAfterMs` 스레딩만.
- **D6 — 컴파일타임 allowlist 보장:** `detailsAllowlist`의 per-key zod 바인딩 상실은 **Known Limitation으로 문서화**(RFC §11). init-time `validateCatalog`에 allowlist 키가 비어있지 않은 문자열인지 정도의 경량 체크만. *근거:* 전면 컴파일 보장은 details 타입 introspection 필요(validateDetails가 미노출).
- **D7 — registry.ts 처리 + SEC-4:** `ErrorCode` union을 **`decision/codes.ts`로 이동**, P3e에서 `registry.ts`(ErrorMeta/DEFAULT_ERROR_REGISTRY) 삭제. 구 `normalizeToDomainError` alias는 **버림**(kernel-only, P5가 새 표면 채택). **SEC-4 nested allowlist는 recurse하지 않고 Known Limitation 유지** — `fieldErrors`(중첩 `Record<string,string[]>`)를 깨지 않기 위해 shallow pick 보존(RFC §11).

---

## 파일 구조 (P3a — 전부 추가 또는 decision/ 내부)

- **Create** `packages/error-core/src/decision/app-error.ts` — 순수 데이터 `AppError` + `appError()` + `isAppError()` + `toSerialized`/free `fromSerialized`/`fromClientSerialized`(AppError 반환).
- **Create** `packages/error-core/src/decision/codes.ts` — `ErrorCode` union + `KNOWN_ERROR_CODES`(frozen Set) SSOT (D2/D7 준비; 지금은 `registry.ts`의 union을 재노출, P3e에서 registry.ts 삭제 시 정본).
- **Create** `packages/error-core/src/decision/system.ts` — `createDecisionSystem` 팩토리 + `fail`/`ok`/`appError`(재노출)/`isFailureDraft` + `finalizeFailure`/`finalizeUnknown` + `toClientErrorPayload`/`pickAllowlistedDetails` + `executeTelemetryDecision`/`executeErrorDecision` + `DetailsOf` + `Success`/`FailureDraft`/`DecisionFailure`/`DecisionResult` 타입 + `defineOperation`/`makeOccurrence`. (EDS에서 포팅, inlined resolve*/validateCatalog 중복 삭제.)
- **Modify** `packages/error-core/src/decision/types.ts` — `ClientErrorPayload` 추가, `UserErrorDecision`에 `messageVars?` 추가, `ReporterSink`/`NotifierSink`(AppError 참조) 추가, `TranslateVars` 재노출.
- **Modify** `packages/error-core/src/decision/resolve.ts` — `resolveErrorDecision`이 `messageVars?`를 통과(D5: 카운트다운 외 케이스만; RATE_LIMITED은 미설정).
- **Modify** `packages/error-core/src/decision/index.ts` — 새 심볼 배럴 추가(구 export 무변경).
- **Modify** `packages/error-core/src/index.ts` — 새 심볼 최상위 배럴 추가(구 export 무변경; P3e에서 정리).
- **Create** `packages/error-core/src/__tests__/app-error-puredata.test.ts`
- **Create** `packages/error-core/src/__tests__/decision-system.test.ts`

구 파일(`app-error.ts`, `registry.ts`, `serialize-client.ts`, `result.ts`, `handle-error.ts`, `normalize.ts`, …)은 **P3a에서 수정 금지**.

> ⚠️ 이름 충돌 주의: 구 `app-error.ts`에 `type AppError = DomainError` alias가 있다. P3a의 새 `class AppError`는 `decision/app-error.ts`에 있고, **배럴에서 새 `AppError`(클래스)가 구 `AppError`(타입 alias)를 가린다.** 두 배럴(`decision/index.ts`, 최상위 `index.ts`)에서 충돌이 나면 — 구 `app-error.ts`는 `export * `로 alias를 내보내고, 새 클래스도 `AppError`다. **해결:** 최상위 `index.ts`에서 구 `app-error`의 `AppError` 타입 alias를 named-export로 내보내지 않도록(또는 `export { DomainError } from "./app-error"`만) 조정하고, `AppError`는 `decision`에서만 나오게 한다. 각 Task의 typecheck 스텝에서 충돌 시 BLOCKED 보고 후 이 노트대로 처리.

---

## Task A1: decision/types.ts 확장 — ClientErrorPayload · messageVars · sinks

**Files:**
- Modify: `packages/error-core/src/decision/types.ts`
- Test: `packages/error-core/src/__tests__/decision-system.test.ts` (이 Task에서 생성, 타입 컴파일 단언으로 시작)

- [x] **Step 1: 실패 테스트(컴파일) 작성** — `decision-system.test.ts` 최상단에 타입 존재 단언:

```typescript
import { describe, it, expect } from "vitest";
import type { ClientErrorPayload, ReporterSink, NotifierSink, UserErrorDecision } from "../decision/types";

describe("P3a decision types", () => {
  it("ClientErrorPayload has the unified §5.3 shape", () => {
    const p: ClientErrorPayload = {
      code: "X", messageKey: "k", disclosure: "generic", action: "none",
    };
    expect(p.code).toBe("X");
    // optional fields compile:
    const full: ClientErrorPayload = { ...p, messageVars: { seconds: 5 }, supportCode: "c", retryAfterMs: 1000, correlationId: "r", digest: "d", details: { a: 1 } };
    expect(full.retryAfterMs).toBe(1000);
  });
  it("UserErrorDecision carries optional messageVars", () => {
    const u = { surface: "toast", disclosure: "generic", messageKey: "k", action: "retry", messageVars: { seconds: 5 } } satisfies UserErrorDecision;
    expect(u.messageVars?.seconds).toBe(5);
  });
});
```

Run: `cd packages/error-core && pnpm vitest run src/__tests__/decision-system.test.ts` → FAIL (`ClientErrorPayload` not exported / `messageVars` not on UserErrorDecision).

- [x] **Step 2: types.ts 수정.** `packages/error-core/src/decision/types.ts`에 다음을 추가한다. (a) `UserErrorDecision`에 `messageVars?` 필드 추가:

```typescript
export interface UserErrorDecision {
  surface: ErrorSurface;
  disclosure: DisclosureLevel;
  messageKey: string;
  messageVars?: TranslateVars; // §5.4 — 보간 인자(render-time 도출; D5)
  action: UserAction;
  target?: string;
  supportCode?: string;
  retryAfterMs?: number;
}
```

(b) 파일에 `TranslateVars`와 `ClientErrorPayload`, sinks 추가. `TranslateVars`는 translator import cycle을 피하려 **여기서 로컬 정의**(translator.ts의 `TranslateVars`와 구조 동일):

```typescript
/** i18n 보간 인자. translator.ts의 TranslateVars와 구조 동일(순환 import 회피). */
export type TranslateVars = Record<string, string | number>;

/** 서버→클라 경계를 넘는 단 하나의 DTO(§5.3). surface/target은 절대 싣지 않는다. */
export interface ClientErrorPayload {
  code: string;
  messageKey: string;
  messageVars?: TranslateVars;
  disclosure: DisclosureLevel;
  action: UserAction; // §5.3: required
  supportCode?: string;
  retryAfterMs?: number;
  correlationId?: string; // 구 error-core 보존
  digest?: string; // RSC 경계용 보존
  details?: unknown; // 단일 allowlist 통과분만
}
```

(c) sinks — `AppError`를 참조하므로 `decision/app-error.ts`에서 import. **Task A2가 app-error.ts를 만들기 전이면** 이 sink 추가는 A2 이후로 미룬다(또는 A2와 함께 커밋). 순서상 sinks는 **A2 직후**에 넣는 게 안전 — 이 Step에서는 `ClientErrorPayload`+`messageVars`까지만 하고, sinks는 A2 Step에서 추가한다. (테스트의 `ReporterSink/NotifierSink` import는 A2까지 주석 처리하거나 A2에서 활성화.)

> 위 테스트가 `ReporterSink`/`NotifierSink`를 import하므로, A1에서는 그 import 줄을 **빼고** ClientErrorPayload/UserErrorDecision만 검증한다. sinks 단언은 A2 Step 4에서 추가.

- [x] **Step 3:** `cd packages/error-core && pnpm vitest run src/__tests__/decision-system.test.ts` → PASS. `pnpm typecheck` → PASS. `pnpm test`(error-core) → 기존 292 + 신규 2 = 294, 회귀 없음.

- [x] **Step 4: 커밋**

```bash
git add packages/error-core/src/decision/types.ts packages/error-core/src/__tests__/decision-system.test.ts
git commit -m "feat(error-core): add ClientErrorPayload + messageVars to decision types (P3a)"
```

## Task A2: 순수 데이터 AppError + appError()/isAppError() + 직렬화/재수화

**Files:**
- Create: `packages/error-core/src/decision/app-error.ts`
- Create: `packages/error-core/src/decision/codes.ts`
- Modify: `packages/error-core/src/decision/types.ts` (sinks)
- Test: `packages/error-core/src/__tests__/app-error-puredata.test.ts`

- [x] **Step 1: codes.ts 생성** — `ErrorCode` SSOT를 decision/로 노출(D2/D7). P3a에서는 registry.ts의 union을 재노출 + frozen set:

```typescript
// error-core/decision/codes.ts — 알려진 에러 코드 SSOT(P3e에서 registry.ts 삭제 시 정본).
import { DEFAULT_ERROR_REGISTRY } from "../registry";

export type ErrorCode = keyof typeof DEFAULT_ERROR_REGISTRY;
export const KNOWN_ERROR_CODES: ReadonlySet<string> = new Set(Object.keys(DEFAULT_ERROR_REGISTRY));
export const isKnownErrorCode = (code: string): code is ErrorCode => KNOWN_ERROR_CODES.has(code);
```

- [x] **Step 2: 실패 테스트 작성** — `app-error-puredata.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { AppError, appError, isAppError } from "../decision/app-error";
import type { DecisionError } from "../decision/resolve";

describe("AppError (pure data)", () => {
  it("appError() constructs a pure-data AppError with no policy getters", () => {
    const e = appError("VALIDATION", { fieldErrors: { email: ["bad"] } }, { correlationId: "r1", retryAfterMs: 1000 });
    expect(e).toBeInstanceOf(AppError);
    expect(e.code).toBe("VALIDATION");
    expect((e.details as any).fieldErrors.email).toEqual(["bad"]);
    expect(e.correlationId).toBe("r1");
    expect(e.retryAfterMs).toBe(1000);
    expect(e.name).toBe("AppError");
    // NO policy getters exist on the instance:
    expect((e as any).severity).toBeUndefined();
    expect((e as any).present).toBeUndefined();
    expect((e as any).httpStatus).toBeUndefined();
    expect(typeof (e as any).resolve).not.toBe("function");
  });

  it("structurally satisfies DecisionError", () => {
    const e = appError("TIMEOUT", null, { retryAfterMs: 500, userCanRetry: true });
    const d: DecisionError = e; // compile-time structural check
    expect(d.code).toBe("TIMEOUT");
    expect(d.retryAfterMs).toBe(500);
  });

  it("isAppError matches instances and duck-types (cross-realm)", () => {
    expect(isAppError(appError("NOT_FOUND"))).toBe(true);
    expect(isAppError({ name: "AppError", code: "X" })).toBe(true); // duck-type
    expect(isAppError({ name: "DomainError", code: "X" })).toBe(true); // legacy duck-type
    expect(isAppError(new Error("x"))).toBe(false);
    expect(isAppError(null)).toBe(false);
  });

  it("toSerialized round-trips through fromSerialized preserving correlationId/digest", () => {
    const e = appError("RATE_LIMITED", { retryAfterMs: 2000 }, { correlationId: "c", digest: "dg", retryAfterMs: 2000 });
    const wire = e.toSerialized();
    const back = AppError.fromSerialized(wire);
    expect(back).toBeInstanceOf(AppError);
    expect(back.code).toBe("RATE_LIMITED");
    expect(back.correlationId).toBe("c");
    expect(back.digest).toBe("dg");
  });
});
```

Run → FAIL (module not found).

- [x] **Step 3: app-error.ts 생성.** 포팅 출처: EDS `DomainError`(`packages/error-decision-system/src/index.ts:196-225`) + `appError`(235-246) + `isDomainError`(248). 변경점: 클래스명 `AppError`, `name="AppError"`, 구 error-core의 `correlationId`/`digest` 필드 추가, 구 `app-error.ts`의 `toSerialized`/`fromSerialized`/`fromClientSerialized` 로직(166-217)을 **AppError 반환 + 통합 모델**로 이식.

```typescript
// error-core/decision/app-error.ts — 통합 순수 데이터 에러 클래스(구 DomainError + EDS DomainError 합집합).
// 정책 getter 없음 — 정책은 decision/resolve.ts resolveErrorDecision이 카탈로그로 해소.
import type { OccurrenceContext, ClientErrorPayload } from "./types";
import { isKnownErrorCode } from "./codes";

export interface SerializedError {
  readonly code: string;
  readonly message: string;
  readonly details: unknown;
  readonly correlationId?: string;
  readonly digest?: string;
}

export interface AppErrorOptions {
  message?: string;
  cause?: unknown;
  occurrence?: Partial<OccurrenceContext>;
  correlationId?: string;
  retryAfterMs?: number;
  userCanRetry?: boolean;
  digest?: string;
}

export class AppError<C extends string = string> extends Error {
  readonly code: C;
  readonly details: unknown;
  override readonly cause?: unknown;
  readonly occurrence?: Partial<OccurrenceContext>;
  readonly correlationId?: string;
  readonly retryAfterMs?: number;
  readonly userCanRetry?: boolean;
  readonly digest?: string;

  constructor(code: C, details: unknown = null, options: AppErrorOptions = {}) {
    super(options.message ?? code);
    this.name = "AppError";
    this.code = code;
    this.details = details;
    this.cause = options.cause;
    this.occurrence = options.occurrence;
    this.correlationId = options.correlationId;
    this.retryAfterMs = options.retryAfterMs;
    this.userCanRetry = options.userCanRetry;
    Object.setPrototypeOf(this, AppError.prototype);
  }

  /** 내부 직렬화(서버 로그용) — message + ungated details 유지. 클라 전송에는 toClientErrorPayload 사용. */
  toSerialized(): SerializedError {
    return { code: this.code, message: this.message, details: this.details, correlationId: this.correlationId, digest: this.digest };
  }

  /** 서버-신뢰 wire(SerializedError) → AppError 재수화. correlationId/digest 보존. */
  static fromSerialized(wire: SerializedError): AppError {
    return new AppError(wire.code, wire.details, { message: wire.message, correlationId: wire.correlationId, digest: wire.digest });
  }

  /** 클라-신뢰 wire(ClientErrorPayload) → AppError 재수화. messageKey는 메시지로 쓰지 않음(키 그대로). */
  static fromClientSerialized(payload: ClientErrorPayload): AppError {
    return new AppError(payload.code, payload.details, {
      correlationId: payload.correlationId, digest: payload.digest, retryAfterMs: payload.retryAfterMs,
    });
  }
}

export const appError = <C extends string>(code: C, details: unknown = null, options: AppErrorOptions = {}): AppError<C> =>
  new AppError(code, details, options);

export const isAppError = (value: unknown): value is AppError =>
  value instanceof AppError ||
  (typeof value === "object" && value !== null &&
    (((value as { name?: unknown }).name === "AppError") || ((value as { name?: unknown }).name === "DomainError")) &&
    typeof (value as { code?: unknown }).code === "string");

// (isKnownErrorCode는 codes.ts에서 — 멤버십 가드 D2가 P3b/P3c에서 사용)
export { isKnownErrorCode };
```

> 포팅 충실도: EDS `DomainError` 본문(196-225)과 비교해 필드/생성자 동작이 일치하는지 확인. `details` 재검증(zod)은 P3a에선 하지 않음(D1: 검증은 finalize 시 `semantics.validateDetails`). `fromSerialized`의 UNKNOWN_* fallback은 P3b에서 normalize와 함께 정교화(여기선 코드 그대로 재수화).

- [x] **Step 4: types.ts에 sinks 추가** (A1에서 미룬 것). `decision/types.ts`에:

```typescript
import type { AppError } from "./app-error";

export interface TelemetryContext extends RuntimeContext {
  operation: string;
}
export interface ReporterSink {
  capture(error: AppError, decision: TelemetryDecision, ctx: TelemetryContext): void;
  breadcrumb(error: AppError, decision: TelemetryDecision, ctx: TelemetryContext): void;
}
export interface NotifierSink {
  alert(error: AppError, decision: TelemetryDecision, ctx: TelemetryContext): void;
}
```

그리고 `decision-system.test.ts`(A1)의 상단 import에 `ReporterSink, NotifierSink`를 활성화하고 컴파일 단언 추가:
```typescript
it("ReporterSink/NotifierSink reference AppError", () => {
  const r: ReporterSink = { capture() {}, breadcrumb() {} };
  const n: NotifierSink = { alert() {} };
  expect(typeof r.capture).toBe("function");
  expect(typeof n.alert).toBe("function");
});
```

> import cycle 주의: `types.ts` → `app-error.ts` → `types.ts`(OccurrenceContext/ClientErrorPayload). **타입 전용 import**(`import type`)이므로 런타임 순환은 없음. typecheck로 확인. 순환이 문제되면 sinks를 `decision/sinks.ts` 별도 파일로 분리.

- [x] **Step 5:** `pnpm vitest run` 두 테스트 PASS, `pnpm typecheck` PASS, `pnpm test`(error-core) green(294+). **커밋:**

```bash
git add packages/error-core/src/decision/app-error.ts packages/error-core/src/decision/codes.ts packages/error-core/src/decision/types.ts packages/error-core/src/__tests__/app-error-puredata.test.ts packages/error-core/src/__tests__/decision-system.test.ts
git commit -m "feat(error-core): add pure-data AppError + appError/isAppError + sinks (P3a)"
```

## Task A3: decision/resolve.ts — messageVars 통과

**Files:**
- Modify: `packages/error-core/src/decision/resolve.ts`
- Test: `packages/error-core/src/__tests__/decision-resolve.test.ts` (기존; 단언 추가)

- [x] **Step 1:** `resolve.ts`의 `resolveErrorDecision`이 만드는 `UserErrorDecision`에 `messageVars`를 추가한다. **D5**에 따라 RATE_LIMITED 카운트다운은 render-time이므로 **여기서는 기본 미설정**, 단 향후 비-시변 보간을 위해 필드만 통과(현재는 `undefined`). 구체적으로 `user` 객체에 `messageVars: undefined`를 명시하거나 생략(타입상 optional). **변경 최소화**: `UserErrorDecision`이 이미 `messageVars?`를 허용하므로 resolve.ts는 그대로 둬도 컴파일된다 → 이 Task는 **단언만 추가**해 "resolve가 messageVars를 깨지 않는다"를 고정.

- [x] **Step 2:** `decision-resolve.test.ts`에 한 케이스 추가:
```typescript
  it("RATE_LIMITED retains retryAfterMs on the decision for render-time {seconds} (D5)", () => {
    const d = decide("RATE_LIMITED", occ({ interaction: "form-submit", uiScope: "form" }), { retryAfterMs: 5000 });
    expect(d.user.retryAfterMs).toBe(5000);
    expect(d.user.messageVars).toBeUndefined(); // 카운트다운은 render-time 도출
  });
```
(주의: `decide` 헬퍼의 errorExtra가 `retryAfterMs`를 받아 `error.retryAfterMs`로 전달하는지 확인 — 기존 헬퍼가 이미 그러함.)

Run → 기대대로 동작 확인. 만약 `d.user.retryAfterMs`가 미설정이면, resolve.ts의 `resolveErrorDecision`에서 `retryAfterMs: error.retryAfterMs`가 user에 들어가는지 확인(P2b 포팅에 포함됨).

- [x] **Step 3:** `pnpm test`(error-core) green. **커밋:**
```bash
git add packages/error-core/src/decision/resolve.ts packages/error-core/src/__tests__/decision-resolve.test.ts
git commit -m "test(error-core): lock retryAfterMs passthrough for render-time messageVars (P3a, D5)"
```

## Task A4: decision/system.ts — createDecisionSystem 팩토리 + finalize + degrade + execute

**Files:**
- Create: `packages/error-core/src/decision/system.ts`
- Test: `packages/error-core/src/__tests__/decision-system.test.ts` (확장)

이 Task가 P3a의 핵심 포팅이다. EDS `index.ts`에서 **커널 조각만** 포팅하고, 이미 grafted된 `../decision/{resolve,validate,catalog}`를 재사용(중복 삭제).

- [x] **Step 1: 포팅 대상 확정(읽기).** `packages/error-decision-system/src/index.ts`를 열어 다음 심볼의 현재 본문/시그니처를 확인한다:
  - 타입: `Success`(174), `FailureDraft`(179), `DecisionFailure`(186), `DecisionResult`(194), `DetailsOf`(270), `ErrorCatalog`/`OperationCatalog`(261-262)
  - free 함수: `ok`(227), `fail`(229-233), `appError`(235-246 — **이미 A2에 있음; system.ts는 A2의 것을 재노출**), `isFailureDraft`(255-259)
  - 팩토리: `createDecisionSystem`(615-931) — 내부의 `lookupSemantics`, `defineOperation`/`getOperation`/`makeOccurrence`, `finalizeDomainError`(→`finalizeAppError`로 rename)/`finalizeFailure`(735)/`finalizeUnknown`(766), `toClientErrorPayload`(690-705), `pickAllowlistedDetails`(437-445), `executeTelemetryDecision`/`executeErrorDecision`
  - **삭제(중복)**: 팩토리 내부/모듈의 `resolveDisclosure/Surface/Action/MessageKey/Target/Telemetry`(447-613), 사설 `resolveErrorDecision`(665-688), `validateCatalog`(418-435), `baselineDisclosureLevels`/`reachableDisclosureLevels`(372-413), `defaultSemantics` — 전부 `../decision/{resolve,validate}`에 이미 있으므로 **포팅하지 말고 import**.

- [x] **Step 2: 실패 테스트 작성**(`decision-system.test.ts`에 추가) — EDS `invariants.test.ts` + `decision.test.ts` 커버리지를 CANONICAL_ERROR_SEMANTICS 기준으로 전사. 최소:

```typescript
import { createDecisionSystem } from "../decision/system";
import { CANONICAL_ERROR_SEMANTICS } from "../decision/catalog";

const sys = createDecisionSystem({
  errors: CANONICAL_ERROR_SEMANTICS,
  operations: {
    "auth.login": { operation: "auth.login", owner: "sec", criticality: "security", defaultUiScope: "form", piiRisk: true },
  },
  fallbackErrorCode: "UNKNOWN_SERVER_ERROR",
  validationErrorCode: "VALIDATION",
});

describe("createDecisionSystem (P3a)", () => {
  it("throws at construction on a bad catalog (validateCatalog wired)", () => {
    expect(() => createDecisionSystem({
      errors: { LEAKY: { code: "LEAKY", category: "business", sensitivity: "auth", defaultHttpStatus: 401, defaultRetryable: false, defaultMessageKey: "secret", detailsExposure: "none" }, UNKNOWN_SERVER_ERROR: CANONICAL_ERROR_SEMANTICS.UNKNOWN_SERVER_ERROR },
      operations: {}, fallbackErrorCode: "UNKNOWN_SERVER_ERROR",
    } as any)).toThrow(/disclosure\/messageKey invariant/);
  });

  it("finalizeFailure precedence: fieldPath -> uiScope:'field'", () => {
    const result = sys.finalizeFailure(sys.fail("VALIDATION", { fieldErrors: { email: ["bad"] } }, { fieldPath: "email" }),
      { operation: "auth.login", interaction: "form-submit", uiScope: "form", criticality: "security" }, { runtime: "server" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.occurrence.uiScope).toBe("field");
      expect(result.decision.user.surface).toBe("field");
    }
  });

  it("toClientErrorPayload emits ONLY the wire shape — never surface/target, never raw message/cause", () => {
    const finalized = sys.finalizeUnknown(appError("SCHEMA_MISMATCH", { secret: "x" }, { message: "internal detail", cause: new Error("boom") }),
      { operation: "p.read", interaction: "query", uiScope: "page", criticality: "core" }, { runtime: "server" });
    const payload = (finalized as any).payload;
    expect(payload).toBeDefined();
    expect((payload as any).surface).toBeUndefined();
    expect((payload as any).target).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain("internal detail");
    expect(JSON.stringify(payload)).not.toContain("boom");
    expect(JSON.stringify(payload)).not.toContain("secret"); // SCHEMA_MISMATCH detailsExposure:'none'
    expect(payload.messageKey).toBeDefined();
    expect(payload.disclosure).toBe("support-only");
  });

  it("single allowlist parity: VALIDATION exposes fieldErrors, RATE_LIMITED exposes retryAfterMs, others none", () => {
    const v = sys.toClientErrorPayload(appError("VALIDATION", { fieldErrors: { a: ["x"] }, extra: "drop" }),
      sys.resolveDecisionFor(appError("VALIDATION", { fieldErrors: { a: ["x"] } }), { operation: "o", interaction: "form-submit", uiScope: "field", criticality: "normal", fieldPath: "a" }, { runtime: "server" }));
    expect((v.details as any)?.fieldErrors).toBeDefined();
    expect((v.details as any)?.extra).toBeUndefined();
  });
});
```

> 위 테스트는 팩토리가 노출해야 하는 표면(`fail`/`finalizeFailure`/`finalizeUnknown`/`toClientErrorPayload`/그리고 헬퍼 `resolveDecisionFor` 등)을 가정한다. **EDS의 실제 메서드 이름/시그니처를 정본으로** 맞추고(예: EDS가 `finalizeFailure`/`finalizeUnknown`을 system 메서드로 노출하는지 확인), 테스트의 호출부를 실제 표면에 맞춰 조정한다. 마지막 케이스의 `resolveDecisionFor`는 예시명 — 실제 팩토리가 내부에서만 resolve한다면 `finalizeUnknown(...).payload`로 단언을 바꾼다.

Run → FAIL(module not found).

- [x] **Step 3: system.ts 작성(포팅).** EDS `createDecisionSystem`(615-931)을 포팅하되:
  - 카탈로그/operations는 options로 주입(이미 EDS가 그러함).
  - inlined `resolve*`/`resolveErrorDecision`/`validateCatalog`/`baselineDisclosureLevels`/`reachableDisclosureLevels`/`defaultSemantics`를 **삭제하고** `import { resolveErrorDecision } from "./resolve"; import { validateCatalog } from "./validate";`로 대체.
  - `appError`/`ok`/`fail`/`isFailureDraft`/`Success`/`FailureDraft`/`DecisionFailure`/`DecisionResult`/`DetailsOf`는 A2의 `appError`를 쓰고 나머지는 EDS에서 포팅. `finalizeDomainError`→`finalizeAppError`(AppError 사용).
  - `DomainError`→`AppError`(A2), `isDomainError`→`isAppError`.
  - `toClientErrorPayload`: EDS 690-705 포팅 + **correlationId/digest를 AppError에서 스레딩** + surface/target 미복사 확인 + `pickAllowlistedDetails`(437) shallow(D7).
  - sinks: `ReporterSink`/`NotifierSink`(A2 types) 사용.
  - **포팅 불가/판단 필요하면 BLOCKED 보고.**

> 본 Task는 verbatim 포팅이 핵심이라 EDS 소스를 정본으로 둔다. 함수 본문을 그대로 옮기고 위 대체/rename만 적용. 인라인 중복(resolve*/validateCatalog)은 반드시 삭제하고 ../decision에서 import(중복 정의는 P0-P2 산출물과 어긋남).

- [x] **Step 4:** 두 테스트(app-error-puredata, decision-system) PASS, `pnpm typecheck` PASS, `pnpm test`(error-core) green(기존 + 신규). **커밋:**
```bash
git add packages/error-core/src/decision/system.ts packages/error-core/src/__tests__/decision-system.test.ts
git commit -m "feat(error-core): port createDecisionSystem factory + finalize/degrade/execute (P3a)"
```

## Task A5: 배럴 추가(additive) + 충돌 처리

**Files:**
- Modify: `packages/error-core/src/decision/index.ts`
- Modify: `packages/error-core/src/index.ts`

- [x] **Step 1:** `decision/index.ts`에 새 export 추가(구 줄 유지):
```typescript
export * from "./types";
export * from "./resolve";
export * from "./validate";
export * from "./app-error";
export * from "./system";
export * from "./codes";
export { CANONICAL_ERROR_SEMANTICS } from "./catalog";
```

- [x] **Step 2:** 최상위 `index.ts`는 이미 `export * from "./decision"`가 있으므로 새 심볼이 자동 노출된다. **이름 충돌 확인**: 구 `app-error.ts`의 `type AppError = DomainError` alias와 새 `class AppError`가 충돌하는지 `pnpm typecheck`로 본다. 충돌 시(파일 상단 ⚠️ 노트대로): 최상위 `index.ts`에서 구 `app-error`의 `AppError` 타입 alias 재노출을 제거(`export { DomainError, isDomainError, ... } from "./app-error"`로 명시 export하고 `AppError` 타입은 빼기). `ErrorCode`도 `codes.ts`와 `registry.ts` 양쪽에서 나오면 한쪽만 노출.

- [x] **Step 3:** `pnpm typecheck` PASS, `pnpm test`(error-core) green. 워크스페이스 `cd /Users/hm2/Private/error-system && pnpm typecheck` → **error-core는 PASS**; error-next/adapters/decision-system도 P3a는 추가만이라 여전히 PASS여야 함(구 표면 무변경). 만약 error-next가 깨지면 충돌 처리(Step 2)가 구 표면을 건드린 것 → 되돌려 구 표면 보존.

- [x] **Step 4: 커밋**
```bash
git add packages/error-core/src/decision/index.ts packages/error-core/src/index.ts
git commit -m "feat(error-core): export AppError + decision-system from barrel, additive (P3a)"
```

## Task A6: P3a 회귀 게이트 + EDS 동등성 확인

**Files:** 없음(검증)

- [x] **Step 1:** `cd packages/error-core && pnpm test` → 기존 292 + 신규(app-error-puredata + decision-system + resolve 추가분) 전부 PASS.
- [x] **Step 2:** `cd /Users/hm2/Private/error-system && pnpm typecheck && pnpm test` → **모든 패키지 PASS**(error-adapters 12 / error-decision-system 43 / error-next 37 불변; error-core 증가). 구 스택 무회귀가 P3a의 핵심 불변식.
- [x] **Step 3:** 동등성 스폿체크 — `decision-system.test.ts`의 시나리오가 EDS `decision.test.ts`의 대응 케이스와 같은 결정을 내는지 1-2개 교차 확인(엔진이 정본).
- [x] **Step 4: P3a 완료 마커 커밋**
```bash
git commit --allow-empty -m "chore(error-core): P3a complete — AppError + decision-system landed additively; old DomainError untouched"
```

---

## Self-Review (작성자 체크)

**Spec coverage(P3a 범위):** §5.1 AppError(순수데이터·getter 제거 방향) → Task A2(추가, 구 클래스와 공존). §5.3 ClientErrorPayload(surface/target off-wire) → A1+A4. §5.4 messageVars 필드 → A1, 통과 → A3(D5: render-time). §5.6 Result 모델(DecisionResult/FailureDraft/finalize) → A4. §5.7 코드 SSOT → A2(codes.ts). createDecisionSystem 카탈로그 주입 + validateCatalog wired → A4. **삭제·컷오버(구 DomainError/ALS/serialize-client/registry)는 P3b–P3e** — 의도적 범위 밖(헤더 명시). ✅

**Placeholder scan:** TBD 없음. "EDS 정본으로 맞춰라/BLOCKED 보고" 지시는 포팅 정합성 가드(placeholder 아님). 단 Task A4의 `resolveDecisionFor`/메서드명은 EDS 실제 표면에 맞춰 조정해야 하는 명시적 reconcile 포인트로 표기됨. ✅

**Type consistency:** `AppError`/`appError`/`isAppError`/`ClientErrorPayload`/`DecisionResult`/`createDecisionSystem`/`finalizeFailure`/`toClientErrorPayload`/`ErrorCode`/`KNOWN_ERROR_CODES`가 정의·사용처에서 일치. `AppError`가 `DecisionError`(resolve.ts) 구조 만족(A2 컴파일 단언). 배럴 충돌은 A5 Step 2에서 명시 처리. ✅

**리스크(실행 중 교차확인):** (1) A4의 EDS 팩토리 포팅 — 실제 메서드 표면(finalize*/toClientErrorPayload 노출 여부, resolve 내부화)을 정본으로 맞출 것. (2) A2/A4 import cycle(types↔app-error) — type-only import로 회피, 안 되면 sinks 분리. (3) A5 배럴 `AppError` 타입 alias vs 클래스 충돌 — 구 표면 보존하며 처리. 시나리오/leak 테스트(A4)가 사후 검증.

---

## 후속 단계 아웃라인 (P3b–P3e — 각자 별도 계획, P3a 착륙 후 전개)

> 정확한 컷오버 코드는 P3a가 실현하는 시그니처(`createDecisionSystem`/`degrade`/`toClientErrorPayload`/`AppError`)에 의존하므로, P3a 머지 후 각 단계를 별도 bite-sized 계획으로 작성한다. 실행 순서는 엄수(의존).

- **P3b — 인바운드 컷오버(medium):** `make-error`/`normalize`/`translator`/`field-errors`/`retry-after`를 `AppError`로. `normalizeToDomainError→normalizeToAppError`(브랜치 순서·correlationId 보존), 멤버십 가드 D2(frozen code-set), translator 하드닝 유지(KEY_TO_CODE를 카탈로그 소스로). 테스트: make-error/rehydration/field-errors/i18n-completeness/network-boundary(rename). **D1(검증 SSOT)·D2를 여기서 확정 적용.**
- **P3c — 아웃바운드 컷오버(high, 보안 load-bearing):** `serialize-client`(구 DETAILS_ALLOWLIST/gateClientDetails/toClientSerialized 삭제 → 단일 `semantics.detailsAllowlist`), `result`(wire `Result.error: ClientErrorPayload` + `degrade(decisionResult)` 헬퍼 D3 + 인프로세스 `DecisionResult` 재노출), `route-handler`(status를 `semantics.defaultHttpStatus`로, body=ClientErrorPayload, 카탈로그 핸들 주입), `network-boundary`(`AppError`로, RATE_LIMITED `retryAfterMs` 인스턴스 필드에 set D5). **leak 테스트: 전체 AppError가 절대 직렬화되지 않음 + payload에 surface/target 없음.** serialize-client.test.ts(217줄) 의도 보존 마이그레이션.
- **P3d — 정책 파이프라인 은퇴(high):** `handle-error`(resolvePolicy/ResolvedPolicy 제거 → `executeErrorDecision`, D4 재작성), `handler`(`setActiveErrorRegistry` 호출 제거), `telemetry`/`notifier`/`console-reporter`(sink 시그니처 `AppError`), `types`(HandleErrorDeps.registry 제거). handle-error.test.ts(360줄: `runWithErrorRegistry` 래퍼 제거, `resolveErrorDecision`/`executeErrorDecision`로 단언)·impact-breadcrumb·composite 마이그레이션. createDecisionSystem-injection 테스트로 구 ALS-substitution 테스트 대체.
- **P3e — 삭제 엔드게임(medium):** `active-registry.ts` 삭제, 구 `app-error.ts`의 DomainError/getter/resolvePolicy/ResolvedPolicy/ResolvedAppError/isExpectedCode/구 ClientSerializedError 삭제, `registry.ts`(ErrorMeta/DEFAULT_ERROR_REGISTRY) 삭제(ErrorCode는 codes.ts로 이미 이동), `schema.ts`(D1) 삭제, `policy.ts`/`severity.ts` grep 후 삭제, 배럴 정리. `per-request-isolation.test.ts` 삭제, `registry-invariants.test.ts` 재앵커. **grep 게이트**로 각 삭제 심볼의 error-core 내 live importer 0 확인 후 삭제. **크로스패키지 break(error-next/apps)는 P3e 헤더에 명시 — kernel-only, error-core만 per-package green; error-next는 P5, apps는 P8에서 새 표면 채택.**

**P3 전체 완료 정의:** error-core가 **하나의 에러 모델(AppError)·하나의 카탈로그 권위(createDecisionSystem 주입)·하나의 allowlist·하나의 wire 페이로드·ALS 없음**을 가지고 per-package green. 이중 정체성(구 DomainError/EDS DomainError)이 비로소 해소되며, error-decision-system 패키지 은퇴(P8)의 전제가 갖춰진다.
