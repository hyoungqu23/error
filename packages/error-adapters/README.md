# error-adapters

**벤더 격리 어댑터.** "벤더를 아는 파일은 정확히 하나"라는 DI 격리 원칙의 구현체다(워크스페이스 ESLint 가드레일이 강제). 각 어댑터는 [`error-core`](../error-core)의 sink 계약(`ReporterSink`/`Presenter`/`NotifierSink`)을 구현하며, 벤더 SDK는 **optional peerDependency**라 쓰지 않는 벤더는 설치할 필요가 없다.

## 어댑터

| 진입점 | 계약 | 벤더 | 비고 |
|---|---|---|---|
| `error-adapters/sentry-reporter` | `ReporterSink` | `@sentry/nextjs` | beforeSend PII 스크럽(tags/fingerprint 포함) · decision fingerprint 그룹핑 · 토큰버킷 storm throttle |
| `error-adapters/sonner-presenter` | `Presenter` | `sonner` | `user.messageKey` 해소 · `{seconds}` 보간 · toast id 디듀프 |
| `error-adapters/pager-notifier` | `NotifierSink` | (웹훅) | `"server-only"` · dedupKey 억제 · 교체 가능한 PagerTransport |

## 사용

```ts
import { createSentryReporter, sentryBeforeSend } from "error-adapters/sentry-reporter";
import { createSonnerPresenter } from "error-adapters/sonner-presenter";
import { createPagerNotifier, webhookPagerTransport } from "error-adapters/pager-notifier";
import { errorSystem } from "error-next"; // 또는 createDecisionSystem으로 자체 카탈로그를 조립

// 컴포지션 루트에서 계약 구현을 조립한다 — 정책은 주입된 DecisionSystem이 소유.
const deps = {
  system: errorSystem,
  reporter: createSentryReporter(), // Sentry.init({ beforeSend: sentryBeforeSend })도 함께 배선할 것
  notifier: createPagerNotifier(webhookPagerTransport(process.env.PAGER_WEBHOOK_URL!)),
};

// Presenter는 파이프라인 밖 소비자 계약 — handleError가 돌려준 decision.user를 직접 넘긴다.
const presenter = createSonnerPresenter();
```

## peerDependencies

```jsonc
{
  "@sentry/nextjs": "^8.0.0",  // optional — sentry-reporter를 쓸 때만
  "sonner": "^1.7.0"           // optional — sonner-presenter를 쓸 때만
}
```

> `sentry-reporter`는 `@sentry/nextjs` v8 API에 맞춰져 있다(`Sentry.SeverityLevel`, captureException 콜백 폼). `pager-notifier`는 벤더 SDK 없이 일반 웹훅을 쓰며 PagerDuty/Opsgenie/Slack 트랜스포트로 교체 가능하다.

## 테스트

```bash
pnpm --filter error-adapters test   # 29 tests
```
