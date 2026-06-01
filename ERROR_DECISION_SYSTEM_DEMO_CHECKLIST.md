# Error Decision System Demo Checklist

이 문서는 `ERROR_DECISION_SYSTEM.md`의 체크리스트를 현재 데모 구현에서 어디로 검증할 수 있는지 연결한다.

## 구현 범위

- 공통 시스템 패키지: `packages/error-decision-system`
- Next.js 데모 앱: `apps/error-decision-next` (`next@^16.2.6`, TypeScript)
- Vite React 데모 앱: `apps/error-decision-vite` (`vite@^5.4.21`, React, TypeScript)

## Inner Architecture

- [x] `ErrorSemantics` 모델: `packages/error-decision-system/src/index.ts`
- [x] 에러 코드별 `category`: `DEMO_ERRORS` in `packages/error-decision-system/src/demo.ts`
- [x] 에러 코드별 `sensitivity`: `DEMO_ERRORS`
- [x] details schema: `validateDetails` in `DEMO_ERRORS`
- [x] client details allowlist: `detailsAllowlist` + `toClientErrorPayload`
- [x] `OccurrenceContext`: `packages/error-decision-system/src/index.ts`
- [x] `DisclosureLevel`: `packages/error-decision-system/src/index.ts`
- [x] `UserAction`: `packages/error-decision-system/src/index.ts`
- [x] `ErrorSurface`: `packages/error-decision-system/src/index.ts`
- [x] `TelemetryDecision`: `packages/error-decision-system/src/index.ts`
- [x] `ErrorDecision`: `packages/error-decision-system/src/index.ts`
- [x] 순수 decision resolver: `resolveErrorDecision`
- [x] resolver는 toast/router/Sentry를 호출하지 않음: `resolveErrorDecision` unit tests
- [x] raw message를 사용자 메시지로 쓰지 않음: `raw Error.message` leakage regression test

## DX Layer

- [x] `defineOperation()`: `createDecisionSystem().defineOperation`
- [x] `defineFormAction()` (2-arg + 3-arg schema): `createDecisionSystem().defineFormAction`
- [x] `defineServerAction()`: `createDecisionSystem().defineServerAction`
- [x] `defineQuery()`: `createDecisionSystem().defineQuery`
- [x] background boundary: `defineBackgroundTask()`
- [x] route guard helper: `defineRouteGuard()` / `protectedPage()`
- [x] render boundary helper: `withRenderBoundary()`
- [x] `executeErrorDecision()` (telemetry 실행 + user decision 반환)
- [x] catalog-typed `decisionSystem.fail()` / `appError()` (code별 details 타입 강제)
- [x] React hooks: `useFormAction()`, `useDecisionQuery()`, `useErrorDecision()` + `DecisionSystemProvider`, `useDecisionRedirect()`
- [x] hooks dogfood: Next `"use client"` LiveForm 아일랜드(RSC 경계) + Vite LiveForm (`useFormAction`/`useDecisionQuery`)
- [x] 짧은 `fail(code, details?)`: `packages/error-decision-system/src/index.ts`
- [x] 짧은 `appError(code, details?)`: `packages/error-decision-system/src/index.ts`
- [x] 80% 케이스에서 occurrence 직접 작성 없음: `loginAction`, `checkoutAction`, `productQuery`
- [x] 80% 케이스에서 telemetry 직접 작성 없음: `loginAction`, `productQuery`
- [x] escape hatch: telemetry override test
- [x] operation string 검증: unknown operation test

## Presentation

- [x] 공통 UI executor: `ErrorSurface` in `packages/error-decision-system/src/react.tsx`
- [x] UI는 `ErrorDecision.user` 실행: Next/Vite apps use `ErrorSurface`
- [x] feature UI의 `error.code` switch 제거: demo apps render decision data only
- [x] raw `error.message` 미노출: leakage regression test
- [x] field/form/page/toast/redirect/silent surface 표현 가능: `ErrorSurface` switch + demo scenarios
- [x] support code 노출 정책: `supportCode` only for generic/support-only fault decisions

## Telemetry

- [x] capture/breadcrumb/alert 분리: `TelemetryDecision`
- [x] alert는 severity threshold만으로 결정하지 않음: `resolveTelemetry`
- [x] criticality 반영: operation catalog + telemetry tests
- [x] fingerprint 정책: `[operation, code, interaction]`
- [x] sampling 정책: `sampleRate`
- [x] correlationId 연결: support-only fault test
- [x] feature code에서 Sentry/pager 직접 호출 없음: demo apps import only decision package

## Security

- [x] auth/permission 에러는 safe-vague: `INVALID_CREDENTIALS`, `AUTH_REQUIRED`, `FORBIDDEN`
- [x] internal/fault 에러는 generic/support-only: `SCHEMA_MISMATCH`, `UNKNOWN_SERVER_ERROR`
- [x] details는 allowlist 기반 전송: `toClientErrorPayload`
- [x] PII/raw internals leakage 방지: leakage regression test
- [x] supportCode는 필요한 경우에만 노출: support-only/generic fault policy

## Testing

- [x] decision resolver unit tests: `packages/error-decision-system/src/__tests__/decision.test.ts`
- [x] scenario matrix tests: validation, login, checkout, schema, background, forbidden, query
- [x] boundary occurrence tests: form/query/background/route guard wrappers
- [x] presenter does not reinterpret code: `ErrorSurface` consumes `ErrorDecision.user`
- [x] telemetry executor does not reinterpret severity: executor test with `level: "fatal"` and `alert: false`
- [x] serialization allowlist test: validation/payment details tests
- [x] raw message leakage regression test: schema mismatch leakage test
- [x] boundary precedence 구별 test: `invariants.test.ts` (boundary > operation, call-site > boundary)
- [x] sampler 주입 계약 test: `invariants.test.ts` (sampleRate 실행 분기)
- [x] registry invariant test: `invariants.test.ts` (messageKey 누락 / fallback 부재 throw)
- [x] scenario matrix snapshot test: `invariants.test.ts`
- [x] per-code details 타입 강제: `invariants.test.ts` (`@ts-expect-error` 3종, typecheck로 검증)
- [x] fieldPath/occurrence 병합 precedence test: `invariants.test.ts`
- [x] redirect target 결정 test: `invariants.test.ts`
- [x] DX examples typecheck: `pnpm typecheck`

## Verification Commands

Last verified:

```bash
pnpm typecheck
pnpm test
pnpm run build
pnpm lint
```

Observed results:

- `pnpm typecheck`: 7 packages successful.
- `pnpm test`: 4 test packages successful, including `error-decision-system` 43 tests (13 scenario + 30 invariant/contract, incl. per-code details `@ts-expect-error` + redirect target).
- `pnpm run build`: existing Next app, new Next app(+`"use client"` LiveForm 아일랜드), and new Vite app(+LiveForm) built successfully. Vite `MODULE_LEVEL_DIRECTIVE`(use client) 경고는 `vite.config.ts` onwarn으로 억제.
- `pnpm lint`: no lint tasks configured in this repo.
