# error-core

프레임워크·벤더 무관 **에러 커널**. 의존성은 `zod` 하나뿐이며, 클라이언트·서버 어디서나 평가해도 안전한(isomorphic) 모듈만 담는다.

`next`·`react`·`"server-only"`·`@sentry/*`·`sonner`·`@tanstack/*` 를 **절대 import하지 않는다.** React/Next 통합은 [`error-next`](../error-next), 벤더 어댑터는 [`error-adapters`](../error-adapters)에 있다.

## 책임

- **레지스트리(SSOT)** — 코드별 정책(`kind`/`severity`/`present`/`log`/`httpStatus`/`retryable`/`userMessageKey`).
- **에러 모델** — `DomainError`(getter는 활성 레지스트리를 읽음), `makeError`, 정규화/재수화(`normalizeToDomainError`).
- **누출 방지 게이트** — `toClientSerialized`가 free-text message를 제거하고 `details`를 허용목록으로 게이팅. `networkBoundary`는 이 public DTO를 다시 `DomainError`로 재수화한다.
- **텔레메트리 계약** — `Reporter`/`Presenter`/`Notifier` 인터페이스 + 단일 처리 경로(`createHandleError`).
- **순수 재시도 정책** — `computeRetryDelay`, `parseRetryAfter`(client+server safe).
- **네트워크 경계** — `networkBoundary`(raw transport → `DomainError`, 8개 코드의 유일 생산자).
- **클라이언트 싱글턴 sink** — `initHandleError`/`handleError`(react/next 의존 없음).
- **순수 리포터 어댑터** — `createConsoleReporter`, `guardedCompositeReporter`(dead-man's-switch).

## 사용

```ts
// 공개 배럴 — 클라이언트 안전 표면
import { makeError, isDomainError, resolveErrorMessage, type Result } from "error-core";

// deep import — 내부 모듈 직접 접근
import { DomainError } from "error-core/app-error";
import { networkBoundary } from "error-core/network-boundary";
```

## 설계

빌드 단계가 없다(raw-TS). `exports` 맵이 `.ts` 소스를 직접 가리키고, 소비 앱의 번들러가 `transpilePackages`로 트랜스파일한다.

커널의 8계층 단방향 구조와 38개 파일의 책임 분리 근거는 [`ARCHITECTURE.md`](ARCHITECTURE.md) 참조.

## 테스트

```bash
pnpm --filter error-core test   # 280 tests
```
