# error-core

프레임워크·벤더 무관 **에러 커널 — 결정(decision) 모델**. 의존성은 `zod` 하나뿐이며(`networkBoundary` 응답 스키마 검증), 클라이언트·서버 어디서나 평가해도 안전한(isomorphic) 모듈만 담는다.

`next`·`react`·`"server-only"`·`@sentry/*`·`sonner`·`@tanstack/*` 를 **절대 import하지 않는다.** React/Next 통합은 [`error-next`](../error-next), 벤더 어댑터는 [`error-adapters`](../error-adapters)에 있다.

## 책임

- **카탈로그(SSOT)** — `CANONICAL_ERROR_SEMANTICS`(15코드 × category/sensitivity/defaultHttpStatus/defaultRetryable/messageKeys/detailsExposure/validateDetails). 런타임 활성-레지스트리는 없다 — 정책은 주입된 `DecisionSystem`이 전부 소유한다.
- **결정 엔진** — `createDecisionSystem` / `resolveErrorDecision`: 같은 코드라도 occurrence 컨텍스트(uiScope/interaction/criticality)에 따라 surface/disclosure/action/telemetry가 달라진다.
- **에러 모델** — 순수-데이터 `AppError`(정책 getter 없음), `makeError`(catalog `validateDetails` + UNKNOWN_\* 폴백), 정규화/재수화(`normalizeToAppError`).
- **단일 누출게이트** — `toClientErrorPayload`: free-text `message` 미전송 + `details`는 catalog allowlist shallow-pick. wire `Result`는 `degrade()`로 이 payload만 건넌다. `networkBoundary`가 이 public DTO를 다시 `AppError`로 재수화한다.
- **텔레메트리 3-sink 계약** — `ReporterSink`/`NotifierSink`(파이프라인 `executeErrorDecision`이 호출) + `Presenter`(파이프라인 밖 소비자 계약) + 단일 처리 경로(`createHandleError`).
- **순수 재시도 정책** — `computeRetryDelay`, `parseRetryAfter`(상한 클램프, client+server safe), `retryAfterHintFromError`(인스턴스 우선).
- **네트워크 경계** — `networkBoundary`(raw transport → `AppError`, 8개 transport 코드의 유일 생산자).
- **클라이언트 싱글턴 sink** — `initHandleError`/`handleError`(react/next 의존 없음).
- **순수 리포터 어댑터** — `createConsoleReporter`, `guardedCompositeReporter`(dead-man's-switch + `health()`).

## 사용

```ts
// 공개 배럴 — 클라이언트 안전 표면
import { makeError, isAppError, resolveErrorMessage, type Result } from "error-core";

// deep import — 내부 모듈 직접 접근
import { AppError } from "error-core/decision/app-error";
import { networkBoundary } from "error-core/network-boundary";
```

## 설계

빌드 단계가 없다(raw-TS). `exports` 맵이 `.ts` 소스를 직접 가리키고, 소비 앱의 번들러가 `transpilePackages`로 트랜스파일한다.

결정 모델의 모듈 구조·불변식(누출게이트/PII/카탈로그)은 [`ARCHITECTURE.md`](ARCHITECTURE.md) 참조.

## 테스트

```bash
pnpm --filter error-core test   # 296+ tests
```
