# Error System 수렴 — P0–P2 (기반) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 신 `error-decision-system`의 결정 엔진·결정 어휘·카탈로그 검증을 `error-core` 안으로 **비파괴적으로(additive)** 이식하고, 기존 15-코드 레지스트리에서 파생한 `ErrorSemantics` 카탈로그로 엔진이 실제로 도는 것을 테스트로 고정한다. 기존 구 스택 코드·테스트는 한 줄도 건드리지 않는다.

**Architecture:** error-core에 `src/decision/` 디렉터리를 신설하여 (1) 결정 어휘 타입, (2) 순수 resolver 함수, (3) `validateCatalog` 불변식, (4) 기존 `DEFAULT_ERROR_REGISTRY`(15코드)에서 파생한 정준 `ErrorSemantics` 카탈로그를 둔다. 모두 신규 파일이라 기존 `app-error.ts`/`registry.ts`/`handle-error.ts` 등은 불변. `DomainError`/`AppError` 통합과 ALS 제거는 후속 P3에서 수행하므로, 이 단계의 resolver는 통합 클래스에 결합하지 않고 **구조적 타입 `DecisionError`**(`{ code; retryAfterMs?; userCanRetry?; details? }`)에만 의존한다.

**Tech Stack:** TypeScript 5.7, Vitest 2.1, pnpm + Turborepo. `error-core`는 zod 외 런타임 의존 없음, 빌드 스텝 없음(raw-TS exports).

**범위 주의:** 이 계획은 전체 수렴(P0–P8) 중 **P0–P2만** 다룬다. P0–P2는 그 자체로 동작하는 테스트 가능한 산출물(검증된 엔진+카탈로그가 error-core에 상주, 구 스택 그대로 green)을 만든다. **P3(keystone: `AppError` 통합 + ALS 제거 + wire 페이로드 통일)와 P4–P8은 각각 별도 계획으로 작성한다** — 후속 단계의 정확한 코드는 P3가 실현하는 통합 shape에 의존하므로, P2가 랜딩된 뒤 error-core 전체 소스를 읽고 계획한다. 근거 스펙: `docs/superpowers/specs/2026-06-02-error-system-convergence-design.md`.

---

## 파일 구조

이 계획에서 생성/수정하는 파일:

- **Create** `packages/error-core/src/decision/types.ts` — 결정 어휘 타입(프레임워크·DomainError 무관, 순수 데이터). EDS `index.ts:1-133`에서 이식.
- **Create** `packages/error-core/src/decision/resolve.ts` — 순수 resolver 함수 + 표준 `resolveErrorDecision` + 구조적 `DecisionError`/`ErrorDecisionInput`. EDS 모듈 레벨 함수 이식.
- **Create** `packages/error-core/src/decision/validate.ts` — `validateCatalog` + `reachableDisclosureLevels` + `baselineDisclosureLevels`. EDS에서 이식.
- **Create** `packages/error-core/src/decision/catalog.ts` — `CANONICAL_ERROR_SEMANTICS`: 기존 15-코드 레지스트리에서 파생한 `ErrorSemantics` 카탈로그(신규 authored: `sensitivity` + per-disclosure `messageKeys`).
- **Create** `packages/error-core/src/decision/index.ts` — decision 서브모듈 배럴.
- **Create** `packages/error-core/src/__tests__/decision-vocabulary.test.ts` — 어휘 타입 컴파일 + 카탈로그 완전성.
- **Create** `packages/error-core/src/__tests__/decision-resolve.test.ts` — 시나리오 매트릭스(엔진 동작 고정).
- **Create** `packages/error-core/src/__tests__/decision-validate.test.ts` — `validateCatalog` 불변식.
- **Modify** `packages/error-core/src/index.ts` — decision 배럴 re-export 추가(기존 export 보존).

기존 파일(`app-error.ts`, `registry.ts`, `serialize-client.ts`, `handle-error.ts`, …)은 **수정하지 않는다**.

---

## Phase 0 — 정리 & baseline

### Task 0.1: 전체 테스트 green baseline 고정

**Files:** 없음(검증만)

- [x] **Step 1: 워크스페이스 의존성 설치 확인**

Run: `cd /Users/hm2/Private/error-system && pnpm install --frozen-lockfile`
Expected: 설치 성공, 에러 없음.

- [x] **Step 2: 전체 테스트 실행해 baseline 기록**

Run: `pnpm test 2>&1 | tee /tmp/eds-baseline.txt`
Expected: 모든 패키지 테스트 PASS. 출력 마지막의 패키지별 통과 수(error-core / error-next / error-adapters / error-decision-system)를 `/tmp/eds-baseline.txt`에 남긴다. 이후 모든 Task는 이 baseline이 깨지지 않아야 한다.

- [x] **Step 3: 타입체크 baseline**

Run: `pnpm typecheck`
Expected: 모든 패키지 PASS.

### Task 0.2: 중복 원격 브랜치 `eds-production-hardening` 제거

**Files:** 없음(git 작업)

- [x] **Step 1: cherry-equivalent(작업트리 동일) 확인**

Run: `git fetch origin && git diff --stat origin/eds-production-hardening origin/main`
Expected: **출력이 비어 있음**(작업트리 바이트 동일 = 고유 콘텐츠 없음). 출력이 비어있지 않으면 **삭제하지 말고 중단**하고 차이를 사람에게 보고한다.

- [x] **Step 2: 비어 있음을 확인한 경우에만 원격 브랜치 삭제**

Run: `git push origin --delete eds-production-hardening`
Expected: `- [deleted] eds-production-hardening`. (외부 상태 변경이므로 Step 1이 비었을 때만 수행.)

- [x] **Step 3: 커밋 불필요(브랜치 메타만 변경).** 다음 Task로 진행.

---

## Phase 1 — 결정 어휘를 error-core에 추가 (additive)

### Task 1.1: 결정 어휘 타입 파일 생성

**Files:**
- Create: `packages/error-core/src/decision/types.ts`

- [x] **Step 1: 어휘 타입 파일 작성**

`packages/error-decision-system/src/index.ts:1-133`의 타입 정의를 이식한다. 단 `ReporterSink`/`NotifierSink`/`TelemetryContext`는 `DomainError`를 참조하므로 **이 파일에 넣지 않는다**(P2에서 구조적 타입과 함께 추가). 아래 내용을 그대로 작성:

```typescript
// error-core/decision/types.ts — 결정 어휘(순수 데이터 타입). DomainError/React/Next 무관.
// 출처: error-decision-system/src/index.ts:1-133 (ReporterSink/NotifierSink 제외)

export type ErrorCategory = "business" | "operational" | "fault";

export type ErrorSensitivity =
  | "public"
  | "auth"
  | "permission"
  | "pii"
  | "business-sensitive"
  | "internal";

export type InteractionKind =
  | "page-load"
  | "query"
  | "mutation"
  | "form-submit"
  | "background-sync"
  | "route-guard"
  | "event-handler"
  | "render";

export type UiScope =
  | "field"
  | "form"
  | "component"
  | "panel"
  | "page"
  | "session"
  | "background";

export type Criticality = "low" | "normal" | "core" | "revenue" | "security";
export type DisclosureLevel = "specific" | "safe-vague" | "generic" | "support-only";

export type UserAction =
  | "fix-input"
  | "retry"
  | "login"
  | "request-access"
  | "choose-different-option"
  | "wait"
  | "go-back"
  | "contact-support"
  | "none";

export type ErrorSurface =
  | "field"
  | "form"
  | "inline"
  | "empty"
  | "toast"
  | "dialog"
  | "page"
  | "redirect"
  | "silent";

export interface TelemetryDecision {
  capture: boolean;
  level: "info" | "warning" | "error" | "fatal";
  breadcrumb: boolean;
  alert: boolean;
  sampleRate?: number;
  fingerprint?: readonly string[];
  tags?: Record<string, string>;
}

export interface ErrorSemantics<Code extends string = string, Details = unknown> {
  code: Code;
  category: ErrorCategory;
  sensitivity: ErrorSensitivity;
  defaultHttpStatus: number;
  defaultRetryable: boolean;
  defaultMessageKey: string;
  messageKeys?: Partial<Record<DisclosureLevel, string>>;
  disclosureByUiScope?: Partial<Record<UiScope, DisclosureLevel>>;
  disclosureByResource?: Partial<Record<string, DisclosureLevel>>;
  actionByResource?: Partial<Record<string, UserAction>>;
  defaultAction?: UserAction;
  actionByUiScope?: Partial<Record<UiScope, UserAction>>;
  actionByInteraction?: Partial<Record<InteractionKind, UserAction>>;
  surfaceByResource?: Partial<Record<string, ErrorSurface>>;
  telemetryBySurface?: Partial<Record<ErrorSurface, Partial<TelemetryDecision>>>;
  redirectTarget?: string;
  detailsExposure: "none" | "allowlist";
  detailsAllowlist?: readonly string[];
  validateDetails?: (details: unknown) => details is Details;
}

export interface OperationMeta<Operation extends string = string> {
  operation: Operation;
  owner: string;
  criticality: Criticality;
  defaultUiScope: UiScope;
  piiRisk: boolean;
}

export interface OccurrenceContext<Operation extends string = string> {
  operation: Operation;
  interaction: InteractionKind;
  uiScope: UiScope;
  criticality: Criticality;
  fieldPath?: string;
  resource?: string;
  userCanRetry?: boolean;
  idempotent?: boolean;
  background?: boolean;
}

export interface RuntimeContext {
  runtime: "server" | "client";
  route?: string;
  user?: { id: string; role?: string } | null;
  correlationId?: string;
  traceId?: string;
}

export interface UserErrorDecision {
  surface: ErrorSurface;
  disclosure: DisclosureLevel;
  messageKey: string;
  action: UserAction;
  target?: string;
  supportCode?: string;
  retryAfterMs?: number;
}

export interface ErrorDecision {
  user: UserErrorDecision;
  telemetry: TelemetryDecision;
}

export type ErrorCatalog = Record<string, ErrorSemantics>;
export type OperationCatalog = Record<string, OperationMeta>;
```

- [x] **Step 2: 타입체크로 컴파일 검증**

Run: `cd packages/error-core && pnpm typecheck`
Expected: PASS (신규 파일이 아직 어디서도 import되지 않아도 tsc --noEmit는 전체를 본다).

- [x] **Step 3: 커밋**

```bash
git add packages/error-core/src/decision/types.ts
git commit -m "feat(error-core): add decision vocabulary types (P1, additive)"
```

### Task 1.2: index 배럴에서 decision 어휘 re-export

**Files:**
- Create: `packages/error-core/src/decision/index.ts`
- Modify: `packages/error-core/src/index.ts`

- [x] **Step 1: decision 배럴 생성**

`packages/error-core/src/decision/index.ts`:

```typescript
// error-core/decision — 결정 엔진 서브모듈 배럴.
export * from "./types";
```

- [x] **Step 2: error-core 최상위 배럴에 decision 추가**

`packages/error-core/src/index.ts`를 열어 **기존 export를 그대로 둔 채** 파일 끝에 다음 줄을 추가:

```typescript
export * from "./decision";
```

- [x] **Step 3: 타입체크**

Run: `cd packages/error-core && pnpm typecheck`
Expected: PASS. 기존 export와 이름 충돌이 없어야 한다(`ErrorCategory` 등은 error-core에 기존에 없던 이름).

- [x] **Step 4: 기존 테스트 회귀 없음 확인**

Run: `cd packages/error-core && pnpm test`
Expected: baseline과 동일하게 전부 PASS.

- [x] **Step 5: 커밋**

```bash
git add packages/error-core/src/decision/index.ts packages/error-core/src/index.ts
git commit -m "feat(error-core): re-export decision vocabulary from barrel (P1)"
```

---

## Phase 2 — 결정 엔진 이식 + 정준 카탈로그 + validateCatalog

### Task 2.1: 정준 ErrorSemantics 카탈로그 작성 (15-코드 shim)

**Files:**
- Create: `packages/error-core/src/decision/catalog.ts`
- Test: `packages/error-core/src/__tests__/decision-vocabulary.test.ts`

기존 `DEFAULT_ERROR_REGISTRY`(`registry.ts:18-37`)의 15개 코드를 `ErrorSemantics`로 파생한다. 매핑: `kind→category`(동일 값), `httpStatus→defaultHttpStatus`, `retryable→defaultRetryable`, `userMessageKey→defaultMessageKey`. **신규 authored 필드:** `sensitivity`(보안 disclosure 축) + 비-public 코드의 per-disclosure `messageKeys`. `present`/`log`/`severity`는 엔진이 도출하므로 옮기지 않는다.

- [x] **Step 1: 실패하는 카탈로그 완전성 테스트 작성**

`packages/error-core/src/__tests__/decision-vocabulary.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { DEFAULT_ERROR_REGISTRY } from "../registry";
import { CANONICAL_ERROR_SEMANTICS } from "../decision/catalog";

describe("CANONICAL_ERROR_SEMANTICS", () => {
  it("covers every code in DEFAULT_ERROR_REGISTRY", () => {
    for (const code of Object.keys(DEFAULT_ERROR_REGISTRY)) {
      expect(CANONICAL_ERROR_SEMANTICS[code], `missing semantics for ${code}`).toBeDefined();
    }
  });

  it("preserves category(kind), httpStatus, retryable, messageKey from the registry", () => {
    for (const [code, meta] of Object.entries(DEFAULT_ERROR_REGISTRY)) {
      const sem = CANONICAL_ERROR_SEMANTICS[code]!;
      expect(sem.category).toBe(meta.kind);
      expect(sem.defaultHttpStatus).toBe(meta.httpStatus);
      expect(sem.defaultRetryable).toBe(meta.retryable);
      expect(sem.defaultMessageKey).toBe(meta.userMessageKey);
    }
  });
});
```

- [x] **Step 2: 테스트 실패 확인**

Run: `cd packages/error-core && pnpm vitest run src/__tests__/decision-vocabulary.test.ts`
Expected: FAIL — `Cannot find module '../decision/catalog'`.

- [x] **Step 3: 카탈로그 작성**

`packages/error-core/src/decision/catalog.ts`. `messageKeys`는 비-public 코드가 도달하는 disclosure 레벨(safe-vague/generic/support-only)을 모두 덮도록 작성(과잉 커버는 무해, validateCatalog 통과 보장):

```typescript
// error-core/decision/catalog.ts — DEFAULT_ERROR_REGISTRY(15코드) → ErrorSemantics 파생.
// sensitivity + per-disclosure messageKeys는 신규 authored(보안 disclosure 축).
import type { ErrorCatalog } from "./types";

export const CANONICAL_ERROR_SEMANTICS = {
  // ── business ──
  VALIDATION: {
    code: "VALIDATION", category: "business", sensitivity: "public",
    defaultHttpStatus: 422, defaultRetryable: false,
    defaultMessageKey: "error.validation", defaultAction: "fix-input",
    detailsExposure: "allowlist", detailsAllowlist: ["fieldErrors"],
  },
  INVALID_CREDENTIALS: {
    code: "INVALID_CREDENTIALS", category: "business", sensitivity: "auth",
    defaultHttpStatus: 401, defaultRetryable: false,
    defaultMessageKey: "error.invalidCredentials", defaultAction: "fix-input",
    messageKeys: { "safe-vague": "error.invalidCredentials" },
    detailsExposure: "none",
  },
  AUTH_REQUIRED: {
    code: "AUTH_REQUIRED", category: "business", sensitivity: "auth",
    defaultHttpStatus: 401, defaultRetryable: false,
    defaultMessageKey: "error.authRequired", defaultAction: "login",
    redirectTarget: "/login",
    messageKeys: { "safe-vague": "error.authRequired" },
    detailsExposure: "none",
  },
  FORBIDDEN: {
    code: "FORBIDDEN", category: "business", sensitivity: "permission",
    defaultHttpStatus: 403, defaultRetryable: false,
    defaultMessageKey: "error.forbidden", defaultAction: "request-access",
    messageKeys: { "safe-vague": "error.forbidden" },
    detailsExposure: "none",
  },
  NOT_FOUND: {
    code: "NOT_FOUND", category: "business", sensitivity: "public",
    defaultHttpStatus: 404, defaultRetryable: false,
    defaultMessageKey: "error.notFound", defaultAction: "go-back",
    detailsExposure: "none",
  },
  // ── operational ──
  OFFLINE: {
    code: "OFFLINE", category: "operational", sensitivity: "public",
    defaultHttpStatus: 503, defaultRetryable: true,
    defaultMessageKey: "error.offline", defaultAction: "retry",
    detailsExposure: "none",
  },
  TIMEOUT: {
    code: "TIMEOUT", category: "operational", sensitivity: "public",
    defaultHttpStatus: 504, defaultRetryable: true,
    defaultMessageKey: "error.timeout", defaultAction: "retry",
    detailsExposure: "none",
  },
  REQUEST_ABORTED: {
    code: "REQUEST_ABORTED", category: "operational", sensitivity: "public",
    defaultHttpStatus: 503, defaultRetryable: false,
    defaultMessageKey: "error.aborted", defaultAction: "none",
    detailsExposure: "none",
  },
  NETWORK_ERROR: {
    code: "NETWORK_ERROR", category: "operational", sensitivity: "public",
    defaultHttpStatus: 502, defaultRetryable: true,
    defaultMessageKey: "error.network", defaultAction: "retry",
    detailsExposure: "none",
  },
  HTTP_CLIENT_ERROR: {
    code: "HTTP_CLIENT_ERROR", category: "operational", sensitivity: "public",
    defaultHttpStatus: 400, defaultRetryable: false,
    defaultMessageKey: "error.httpClient", defaultAction: "none",
    detailsExposure: "none",
  },
  RATE_LIMITED: {
    code: "RATE_LIMITED", category: "operational", sensitivity: "public",
    defaultHttpStatus: 429, defaultRetryable: true,
    defaultMessageKey: "error.rateLimited", defaultAction: "wait",
    detailsExposure: "allowlist", detailsAllowlist: ["retryAfterMs"],
  },
  // ── fault (criticality에 따라 generic 또는 support-only 도달) ──
  HTTP_SERVER_ERROR: {
    code: "HTTP_SERVER_ERROR", category: "fault", sensitivity: "internal",
    defaultHttpStatus: 500, defaultRetryable: true,
    defaultMessageKey: "error.httpServer", defaultAction: "retry",
    messageKeys: { generic: "error.httpServer", "support-only": "error.support" },
    detailsExposure: "none",
  },
  SCHEMA_MISMATCH: {
    code: "SCHEMA_MISMATCH", category: "fault", sensitivity: "internal",
    defaultHttpStatus: 502, defaultRetryable: false,
    defaultMessageKey: "error.schema", defaultAction: "contact-support",
    messageKeys: { generic: "error.schema", "support-only": "error.support" },
    detailsExposure: "none",
  },
  UNKNOWN_SERVER_ERROR: {
    code: "UNKNOWN_SERVER_ERROR", category: "fault", sensitivity: "internal",
    defaultHttpStatus: 500, defaultRetryable: false,
    defaultMessageKey: "error.unknown", defaultAction: "contact-support",
    messageKeys: { generic: "error.unknown", "support-only": "error.support" },
    detailsExposure: "none",
  },
  UNKNOWN_CLIENT_ERROR: {
    code: "UNKNOWN_CLIENT_ERROR", category: "fault", sensitivity: "internal",
    defaultHttpStatus: 500, defaultRetryable: false,
    defaultMessageKey: "error.unknown", defaultAction: "retry",
    messageKeys: { generic: "error.unknown", "support-only": "error.support" },
    detailsExposure: "none",
  },
} as const satisfies ErrorCatalog;
```

- [x] **Step 4: 테스트 통과 확인**

Run: `cd packages/error-core && pnpm vitest run src/__tests__/decision-vocabulary.test.ts`
Expected: PASS (2 tests).

- [x] **Step 5: 커밋**

```bash
git add packages/error-core/src/decision/catalog.ts packages/error-core/src/__tests__/decision-vocabulary.test.ts
git commit -m "feat(error-core): derive canonical ErrorSemantics catalog from registry (P2)"
```

### Task 2.2: validateCatalog + 도달 disclosure 불변식 이식

**Files:**
- Create: `packages/error-core/src/decision/validate.ts`
- Test: `packages/error-core/src/__tests__/decision-validate.test.ts`

- [x] **Step 1: 실패하는 불변식 테스트 작성**

`packages/error-core/src/__tests__/decision-validate.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { validateCatalog } from "../decision/validate";
import { CANONICAL_ERROR_SEMANTICS } from "../decision/catalog";
import type { ErrorCatalog } from "../decision/types";

describe("validateCatalog", () => {
  it("passes for the canonical catalog with a valid fallbackErrorCode", () => {
    expect(() => validateCatalog(CANONICAL_ERROR_SEMANTICS, "UNKNOWN_SERVER_ERROR")).not.toThrow();
  });

  it("throws when fallbackErrorCode is absent from the catalog", () => {
    expect(() => validateCatalog(CANONICAL_ERROR_SEMANTICS, "NOT_A_CODE")).toThrow(/fallbackErrorCode/);
  });

  it("throws when a reachable disclosure level lacks a safe messageKey", () => {
    const broken: ErrorCatalog = {
      LEAKY: {
        code: "LEAKY", category: "business", sensitivity: "auth",
        defaultHttpStatus: 401, defaultRetryable: false,
        defaultMessageKey: "secret.reason", // safe-vague reachable but no messageKeys
        detailsExposure: "none",
      },
      UNKNOWN_SERVER_ERROR: CANONICAL_ERROR_SEMANTICS.UNKNOWN_SERVER_ERROR,
    };
    expect(() => validateCatalog(broken, "UNKNOWN_SERVER_ERROR")).toThrow(/disclosure\/messageKey invariant/);
  });
});
```

- [x] **Step 2: 테스트 실패 확인**

Run: `cd packages/error-core && pnpm vitest run src/__tests__/decision-validate.test.ts`
Expected: FAIL — `Cannot find module '../decision/validate'`.

- [x] **Step 3: validate.ts 작성**

`packages/error-decision-system/src/index.ts`의 `baselineDisclosureLevels`(403 직전), `reachableDisclosureLevels`(403-413), `validateCatalog`(418-435) 세 함수를 이식한다. 아래는 그 세 함수의 합본(원본과 동일 로직, 메시지 prefix만 `[error-core/decision]`으로 변경, 타입은 decision/types에서 import):

```typescript
// error-core/decision/validate.ts — 카탈로그 init-time 불변식. 출처: EDS index.ts (validateCatalog).
import type { ErrorCatalog, ErrorSemantics, DisclosureLevel } from "./types";

// 한 코드가 (override 없이) 도달하는 기본 disclosure 레벨들.
const baselineDisclosureLevels = (semantics: ErrorSemantics): DisclosureLevel[] => {
  if (semantics.category === "fault") return ["generic", "support-only"];
  switch (semantics.sensitivity) {
    case "public":
      return ["specific"];
    case "auth":
    case "permission":
    case "business-sensitive":
      return ["safe-vague"];
    case "pii":
      return ["safe-vague", "support-only"];
    case "internal":
      return ["generic"];
  }
};

const reachableDisclosureLevels = (semantics: ErrorSemantics): DisclosureLevel[] => {
  const levels = new Set<DisclosureLevel>(baselineDisclosureLevels(semantics));
  for (const level of Object.values(semantics.disclosureByUiScope ?? {})) {
    if (level) levels.add(level);
  }
  for (const level of Object.values(semantics.disclosureByResource ?? {})) {
    if (level) levels.add(level);
  }
  levels.delete("specific");
  return [...levels];
};

export { reachableDisclosureLevels };

// 민감한 disclosure 레벨은 반드시 messageKeys에서 안전한 copy를 골라야 한다(민감한 defaultMessageKey로
// 흘러가면 안 됨). 잘못 구성된 카탈로그는 런타임 누출 대신 생성 시점에 시끄럽게 실패한다.
export const validateCatalog = (errors: ErrorCatalog, fallbackErrorCode: string): void => {
  if (!errors[fallbackErrorCode]) {
    throw new Error(`[error-core/decision] fallbackErrorCode "${fallbackErrorCode}" is not present in the error catalog.`);
  }
  const problems: string[] = [];
  for (const [code, semantics] of Object.entries(errors)) {
    for (const level of reachableDisclosureLevels(semantics)) {
      if (!semantics.messageKeys?.[level]) {
        problems.push(`  - "${code}" can resolve to disclosure "${level}" but has no messageKeys["${level}"]`);
      }
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `[error-core/decision] disclosure/messageKey invariant failed. Each error must define a safe messageKey for every disclosure level it can reach:\n${problems.join("\n")}`,
    );
  }
};
```

> **주의:** 위 `baselineDisclosureLevels`는 EDS 원본과 동작이 일치해야 한다. EDS 원본(`index.ts`의 `baselineDisclosureLevels`)을 열어 본문이 위와 다르면 **원본을 정본으로** 맞춘다(이 파일의 로직이 `resolveDisclosure`의 fallback 분기와 일치하는지 교차 확인).

- [x] **Step 4: 테스트 통과 확인**

Run: `cd packages/error-core && pnpm vitest run src/__tests__/decision-validate.test.ts`
Expected: PASS (3 tests). 만약 1번 테스트가 "missing messageKeys" 로 실패하면, 그 코드의 누락된 disclosure 레벨 messageKey를 `catalog.ts`에 추가하고 다시 실행(TDD 반복).

- [x] **Step 5: 커밋**

```bash
git add packages/error-core/src/decision/validate.ts packages/error-core/src/__tests__/decision-validate.test.ts
git commit -m "feat(error-core): port validateCatalog disclosure invariant (P2)"
```

### Task 2.3: 순수 resolver 함수 이식

**Files:**
- Create: `packages/error-core/src/decision/resolve.ts`

이 단계의 resolver는 통합 `AppError`(P3 산출)에 결합하지 않고 구조적 타입 `DecisionError`에만 의존한다.

- [x] **Step 1: resolve.ts 작성 — 구조적 타입 + 이식 함수**

`error-decision-system/src/index.ts`의 모듈 레벨 순수 함수들을 이식한다: `pickAllowlistedDetails`(437-445), `resolveDisclosure`(447-474), `resolveSurface`(476-503), `guardIdempotency`(508-509), `resolveAction`(511-526), `resolveMessageKey`(528-529), `resolveTarget`(533-542), `resolveTelemetry`(543-664). **변경점은 두 가지뿐:** (a) 이 함수들이 참조하는 `DomainError`를 아래 구조적 `DecisionError`로 교체, (b) 타입 import를 `./types`로.

먼저 파일 상단에 구조적 타입과 입력 타입을 정의:

```typescript
// error-core/decision/resolve.ts — 순수 결정 resolver. 통합 AppError(P3)에 결합하지 않도록
// 구조적 DecisionError에만 의존한다. 함수 본문은 error-decision-system/src/index.ts에서 이식.
import type {
  ErrorSemantics, OccurrenceContext, RuntimeContext,
  UserErrorDecision, TelemetryDecision, ErrorDecision,
  DisclosureLevel, UserAction, ErrorSurface,
} from "./types";

/** resolver가 에러에서 읽는 최소 구조. P3에서 AppError가 이 형태를 구조적으로 만족한다. */
export interface DecisionError {
  code: string;
  retryAfterMs?: number;
  userCanRetry?: boolean;
  details?: unknown;
}

export interface ErrorDecisionInput {
  error: DecisionError;
  semantics: ErrorSemantics;
  occurrence: OccurrenceContext;
  runtime: RuntimeContext;
}
```

그 다음, EDS에서 이식한 함수 본문을 붙인다. `resolveSurface`/`resolveAction`의 시그니처에서 `error: DomainError`/`_error: DomainError`를 `error: DecisionError`/`_error: DecisionError`로 바꾼다. (그 외 본문은 그대로.) 마지막에 표준 합성 함수를 추가:

```typescript
const shouldExposeSupportCode = (disclosure: DisclosureLevel): boolean =>
  disclosure === "support-only";

export const resolveErrorDecision = (input: ErrorDecisionInput): ErrorDecision => {
  const { error, semantics, occurrence } = input;
  const disclosure = resolveDisclosure(semantics, occurrence);
  const action = resolveAction(error, semantics, occurrence);
  const surface = resolveSurface(error, semantics, occurrence, action);
  const user: UserErrorDecision = {
    surface,
    disclosure,
    messageKey: resolveMessageKey(semantics, disclosure),
    action,
    target: resolveTarget(semantics, surface, occurrence),
    supportCode: shouldExposeSupportCode(disclosure) ? input.runtime.correlationId : undefined,
    retryAfterMs: error.retryAfterMs,
  };
  const telemetry: TelemetryDecision = resolveTelemetry(input);
  return { user, telemetry };
};
```

> **주의 1:** `resolveTarget`(EDS 533-542)와 `resolveTelemetry`(EDS 543-664)의 **정확한 시그니처를 원본에서 확인**하고 위 호출부를 맞춘다. 원본 `resolveErrorDecision`(EDS 665+) 본문이 위 합성과 다르면(특히 supportCode/target 결정 순서) **원본을 정본으로** 맞춘다.
> **주의 2:** `resolveTelemetry`가 `Math.random` 기반 샘플링을 직접 하지 않고 `sampleRate`만 *결정*하는지 확인한다(실행은 P3의 executor). 결정만 한다면 그대로 이식.

- [x] **Step 2: 타입체크**

Run: `cd packages/error-core && pnpm typecheck`
Expected: PASS. 컴파일 에러가 나면 이식한 함수의 `DomainError` 잔존 참조를 `DecisionError`로 모두 교체했는지 확인.

- [x] **Step 3: 커밋**

```bash
git add packages/error-core/src/decision/resolve.ts
git commit -m "feat(error-core): port pure decision resolver functions (P2)"
```

### Task 2.4: resolve/validate를 decision 배럴에 노출

**Files:**
- Modify: `packages/error-core/src/decision/index.ts`

- [x] **Step 1: 배럴 확장**

`packages/error-core/src/decision/index.ts`를 다음으로 교체:

```typescript
// error-core/decision — 결정 엔진 서브모듈 배럴.
export * from "./types";
export * from "./resolve";
export * from "./validate";
export { CANONICAL_ERROR_SEMANTICS } from "./catalog";
```

- [x] **Step 2: 타입체크 + 기존 테스트 회귀 없음**

Run: `cd packages/error-core && pnpm typecheck && pnpm test`
Expected: 모두 PASS, baseline 유지.

- [x] **Step 3: 커밋**

```bash
git add packages/error-core/src/decision/index.ts
git commit -m "feat(error-core): expose resolver + validate from decision barrel (P2)"
```

### Task 2.5: 시나리오 매트릭스 테스트 — 엔진 동작 고정

**Files:**
- Test: `packages/error-core/src/__tests__/decision-resolve.test.ts`

`docs/history/ERROR_DECISION_SYSTEM.md`의 대표 시나리오를 정준 카탈로그에 대해 고정한다. 엔진이 error-core 안에서 실제로 문서화된 결정을 내는지 증명한다.

- [x] **Step 1: 시나리오 테스트 작성**

`packages/error-core/src/__tests__/decision-resolve.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { resolveErrorDecision, type ErrorDecisionInput } from "../decision/resolve";
import { CANONICAL_ERROR_SEMANTICS } from "../decision/catalog";
import type { OccurrenceContext, RuntimeContext } from "../decision/types";

const runtime: RuntimeContext = { runtime: "server" };

const decide = (
  code: keyof typeof CANONICAL_ERROR_SEMANTICS,
  occurrence: OccurrenceContext,
  errorExtra: { retryAfterMs?: number; userCanRetry?: boolean } = {},
) => {
  const input: ErrorDecisionInput = {
    error: { code, ...errorExtra },
    semantics: CANONICAL_ERROR_SEMANTICS[code],
    occurrence,
    runtime,
  };
  return resolveErrorDecision(input);
};

const occ = (over: Partial<OccurrenceContext>): OccurrenceContext => ({
  operation: "test.op",
  interaction: "form-submit",
  uiScope: "form",
  criticality: "normal",
  ...over,
});

describe("resolveErrorDecision — scenario matrix (canonical catalog)", () => {
  it("VALIDATION + field → field surface, specific disclosure, fix-input, no capture", () => {
    const d = decide("VALIDATION", occ({ interaction: "form-submit", uiScope: "field", fieldPath: "email" }));
    expect(d.user.surface).toBe("field");
    expect(d.user.disclosure).toBe("specific");
    expect(d.user.action).toBe("fix-input");
    expect(d.telemetry.capture).toBe(false);
  });

  it("INVALID_CREDENTIALS + login form → form surface, safe-vague disclosure", () => {
    const d = decide("INVALID_CREDENTIALS", occ({ uiScope: "form", criticality: "security" }));
    expect(d.user.surface).toBe("form");
    expect(d.user.disclosure).toBe("safe-vague");
  });

  it("AUTH_REQUIRED + route-guard → redirect surface, login action", () => {
    const d = decide("AUTH_REQUIRED", occ({ interaction: "route-guard", uiScope: "page", criticality: "security" }));
    expect(d.user.surface).toBe("redirect");
    expect(d.user.action).toBe("login");
  });

  it("FORBIDDEN + admin page → page surface, safe-vague, warning capture", () => {
    const d = decide("FORBIDDEN", occ({ interaction: "route-guard", uiScope: "page", criticality: "security" }));
    expect(d.user.surface).toBe("page");
    expect(d.user.disclosure).toBe("safe-vague");
    expect(d.telemetry.capture).toBe(true);
  });

  it("SCHEMA_MISMATCH + page query (core) → page surface, support-only, capture", () => {
    const d = decide("SCHEMA_MISMATCH", occ({ interaction: "query", uiScope: "page", criticality: "core" }));
    expect(d.user.surface).toBe("page");
    expect(d.user.disclosure).toBe("support-only");
    expect(d.telemetry.capture).toBe(true);
  });

  it("TIMEOUT + non-idempotent checkout submit → dialog surface, wait action (idempotency downgrade)", () => {
    const d = decide("TIMEOUT", occ({ interaction: "form-submit", uiScope: "form", criticality: "revenue", idempotent: false }));
    expect(d.user.surface).toBe("dialog");
    expect(d.user.action).toBe("wait");
  });

  it("NETWORK_ERROR + background prefetch → silent surface", () => {
    const d = decide("NETWORK_ERROR", occ({ interaction: "background-sync", uiScope: "background", criticality: "low" }));
    expect(d.user.surface).toBe("silent");
  });
});
```

- [x] **Step 2: 테스트 실행**

Run: `cd packages/error-core && pnpm vitest run src/__tests__/decision-resolve.test.ts`
Expected: PASS (7 tests).

> 일부 단언이 실패하면, **엔진 동작이 정본**이다(이식한 resolver는 EDS와 동일하므로). 기대값을 EDS의 동일 시나리오(`error-decision-system/src/__tests__/decision.test.ts`)와 대조해 맞춘다. 카탈로그의 `sensitivity`/`messageKeys`/`defaultAction`이 원인이면 `catalog.ts`를 EDS `demo.ts`의 대응 코드 설정과 맞춘다. (예: SCHEMA_MISMATCH가 support-only가 되려면 fault+core 조합이 필요 — 이미 충족.)

- [x] **Step 3: 커밋**

```bash
git add packages/error-core/src/__tests__/decision-resolve.test.ts
git commit -m "test(error-core): lock decision scenario matrix on canonical catalog (P2)"
```

### Task 2.6: 전체 회귀 + 타입체크 최종 게이트

**Files:** 없음(검증)

- [x] **Step 1: error-core 전체 테스트**

Run: `cd packages/error-core && pnpm test`
Expected: 기존 테스트 + 신규 decision 테스트(vocabulary 2 + validate 3 + resolve 7 = 12) 전부 PASS.

- [x] **Step 2: 워크스페이스 전체 회귀**

Run: `cd /Users/hm2/Private/error-system && pnpm typecheck && pnpm test`
Expected: 모든 패키지 PASS. 구 스택(error-next/error-adapters)·신 시스템(error-decision-system)은 baseline(`/tmp/eds-baseline.txt`)과 동일, error-core는 +12 테스트.

- [x] **Step 3: P2 완료 커밋(메타)**

```bash
git commit --allow-empty -m "chore(error-core): P2 complete — decision engine grafted into error-core, canonical catalog validated, old stack untouched"
```

---

## Self-Review (작성자 체크)

**1. Spec coverage (P0–P2 범위):**
- §3 "정적 카탈로그" → CANONICAL_ERROR_SEMANTICS(Task 2.1). ✅
- §5.2 "ErrorMeta→ErrorSemantics 매핑, present/log/severity 강등" → catalog.ts가 kind/httpStatus/retryable/userMessageKey만 옮기고 present/log/severity 제외. ✅
- §5.5 "disclosure 구조적 강제 + validateCatalog" → Task 2.2. ✅
- §5.7 "transport 8코드 포함 어휘 병합" → catalog.ts가 OFFLINE~SCHEMA_MISMATCH 8개 transport 코드 포함. ✅ (EDS 고유 코드 병합은 P3+, 정준 15코드가 P2 범위.)
- §9 P0/P1/P2 → Phase 0/1/2. ✅
- §2.2 "검증된 코드 보존" → 기존 파일 무수정(additive). ✅
- **범위 밖(P3+)으로 의도적 제외:** AppError 통합·ALS 제거·wire 페이로드·Result 모델 분리·error-react/next/adapters·가드레일·데모/문서 수렴. 후속 계획에서 다룸(헤더에 명시). ✅

**2. Placeholder scan:** TBD/TODO 없음. 모든 코드 스텝에 실제 코드. "주의" 블록은 이식 정합성 교차확인 지시(placeholder 아님). ✅

**3. Type consistency:** `ErrorSemantics`/`ErrorCatalog`/`OccurrenceContext`/`RuntimeContext`/`ErrorDecisionInput`/`DecisionError`/`resolveErrorDecision`/`validateCatalog`/`CANONICAL_ERROR_SEMANTICS`가 정의 파일과 사용처(테스트)에서 동일 이름·시그니처. resolver는 `DecisionError`(구조적)에만 의존하고 P3에서 `AppError`가 이를 만족 — 일관. ✅

**알려진 이식 리스크(실행 중 교차확인 필요):** Task 2.2의 `baselineDisclosureLevels`와 Task 2.3의 `resolveTarget`/`resolveTelemetry`/`resolveErrorDecision` 합성은 EDS 원본을 정본으로 맞춰야 한다(각 Task의 "주의" 블록). 시나리오 테스트(2.5)가 이 정합성을 사후 검증한다.
