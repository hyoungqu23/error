# 통합 에러 시스템 — Turborepo 모노레포

Next.js(App Router) 애플리케이션을 위한 **통합 에러 시스템**을, 프레임워크·벤더 무관 커널에서부터 Next/React 통합 계층까지 8계층 단방향 의존성으로 설계한 것을 **3개 패키지 + 레퍼런스 앱**으로 분리한 모노레포다.

> 분리 전에는 단일 `src/core/error/`(38개 파일)였다. 아키텍처 계층과 "벤더를 아는 파일은 하나"라는 DI 격리 원칙을 **물리적 패키지 경계**로 만들어, 소비자가 필요한 만큼만(예: `error-core`는 zod만) 설치할 수 있게 했다. 커널의 상세 설계는 [`packages/error-core/ARCHITECTURE.md`](packages/error-core/ARCHITECTURE.md) 참조.

## 구성

```
.
├── packages/
│   ├── error-core/        # 프레임워크·벤더 무관 isomorphic 커널 (의존: zod)
│   ├── error-adapters/    # 벤더 격리 어댑터 — Sentry · sonner · pager (optional peerDeps)
│   └── error-next/        # Next.js(App Router) + React 통합 (peerDeps: next, react, @tanstack)
└── apps/
    └── error-architecture/  # 위 패키지를 소비하는 Next.js 16 레퍼런스 앱
```

### 의존성 방향 (단방향)

```
error-core  ◄──  error-adapters  ◄──  error-next  ◄──  apps/error-architecture
     ▲                                    │
     └────────────────────────────────────┘
```

- **`error-core`** — 레지스트리(SSOT)·정책 해소·정규화·직렬화 누출 게이트·텔레메트리 계약·단일 처리 경로·순수 재시도 정책·`networkBoundary`·클라이언트 싱글턴 sink. `next`·`react`·`server-only`·벤더 SDK를 **절대** import하지 않는다.
- **`error-adapters`** — `@sentry/nextjs`(Reporter)·`sonner`(Presenter)·pager(Notifier). "벤더를 아는 파일은 정확히 하나". 각 어댑터는 독립 진입점이고 벤더 SDK는 **optional peerDependency**.
- **`error-next`** — 뮤테이션/폼/라우트/네비게이션 경계, 요청별 서버 컴포지션 루트, `useErrorHandler`, `QueryClient`, 에러 바운더리 컴포넌트.
  - 클라이언트 표면: `import { … } from "error-next"`
  - 서버 전용 표면: `import { … } from "error-next/server"` (`"server-only"` 가드)

## 핵심 설계 결정

| 결정 | 이유 |
|---|---|
| **raw-TS 내부 패키지(빌드 단계 없음)** | 패키지는 `.ts` 소스를 그대로 export(`exports` 맵). 앱 번들러가 `transpilePackages`로 트랜스파일. 빌드/watch 오케스트레이션 불필요. |
| **공개 표면 2개 유지** | 소비자는 클라이언트 배럴(`error-next`)·서버 배럴(`error-next/server`)만 본다. 내부 모듈은 deep import(`error-core/app-error`)도 가능. |
| **server-only 누출 방지** | 클라이언트 배럴의 전이 import 폐포에 `"server-only"` 모듈이 하나도 없다. 잘못된 클라 import는 런타임 누출이 아니라 **빌드 에러**가 된다. |
| **벤더 버전 핀 유지** | 커널/어댑터는 검증된 baseline(zod 3 · @sentry 8 · sonner 1 · TanStack 5 · vitest 2)을 그대로 써 329개 테스트를 보존. **앱만** Next 16 · React 19.2. peer 범위가 둘 다 커버. |

## 명령어

```bash
pnpm install              # 워크스페이스 전체 설치 (pnpm 11+)

pnpm typecheck            # turbo: 3개 패키지 tsc --noEmit
pnpm test                 # turbo: 329개 테스트 (core 280 · adapters 12 · next 37)
pnpm build                # turbo: 앱 next build (Turbopack)
pnpm dev                  # turbo: 앱 dev 서버

# 개별 패키지
pnpm --filter error-core test
pnpm --filter error-architecture-app dev
```

## 레퍼런스 앱

`apps/error-architecture` 는 세 패키지를 소비하며 통합 에러 시스템을 시연한다:

- **`/demo/form-action`** — `safeFormAction` + `useActionState`. Zod 검증 실패는 VALIDATION 인라인 필드 에러, 비즈니스 에러는 직렬화 안전 `Result.Failure`.
- **`/demo/query-retry`** — `networkBoundary` + TanStack Query. `retryable` 배선으로 404는 무재시도, 429/5xx는 Retry-After/백오프 재시도. 실패는 sonner 토스트.
- **`/demo/boundaries`** — `raise()`가 expected 에러를 Next 인터럽트로 변환(NOT_FOUND→`notFound()`, FORBIDDEN→`forbidden()`), unexpected fault는 `error.tsx`.
- **`/api/health`** — 텔레메트리 dead-man's-switch 헬스 프로브.
- **`proxy.ts`** — 모든 요청에 `x-request-id` 상관관계 ID를 심어 응답 헤더·쿠키로 클라이언트까지 전파.

## 요구사항

- Node.js ≥ 20.9
- pnpm ≥ 11
