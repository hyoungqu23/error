# error-adapters

**벤더 격리 어댑터.** "벤더를 아는 파일은 정확히 하나"라는 DI 격리 원칙의 구현체다. 각 어댑터는 [`error-core`](../error-core)의 계약(`Reporter`/`Presenter`/`Notifier`)을 구현하며, 벤더 SDK는 **optional peerDependency**라 쓰지 않는 벤더는 설치할 필요가 없다.

## 어댑터

| 진입점 | 계약 | 벤더 | 비고 |
|---|---|---|---|
| `error-adapters/sentry-reporter` | `Reporter` | `@sentry/nextjs` | beforeSend PII 스크럽 · fingerprint · 토큰버킷 throttle · breadcrumb |
| `error-adapters/sonner-presenter` | `Presenter` | `sonner` | 카피 해소 · toast id 디듀프 |
| `error-adapters/pager-notifier` | `Notifier` | (웹훅) | `"server-only"` · dedupKey 억제 · 교체 가능한 PagerTransport |

## 사용

```ts
import { createSentryReporter } from "error-adapters/sentry-reporter";
import { createSonnerPresenter } from "error-adapters/sonner-presenter";
import { createPagerNotifier, webhookPagerTransport } from "error-adapters/pager-notifier";

// 컴포지션 루트에서 계약 구현을 조립한다.
const deps = {
  registry: getActiveErrorRegistry(),
  reporter: createSentryReporter(),
  presenter: createSonnerPresenter(),
  notifier: createPagerNotifier(webhookPagerTransport(process.env.PAGER_WEBHOOK_URL!)),
};
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
pnpm --filter error-adapters test   # 11 tests
```
