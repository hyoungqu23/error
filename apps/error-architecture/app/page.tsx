import Link from "next/link";

// app/page.tsx — 데모 인덱스. 통합 에러 시스템의 경계/트랙/바운더리를 시연하는 페이지들로 안내한다.

const demos = [
  {
    href: "/demo/form-action",
    title: "뮤테이션 트랙 · safeFormAction",
    badge: "Server Action",
    desc: "useActionState 호환 폼 액션. Zod 검증 실패는 VALIDATION 인라인 필드 에러로, 비즈니스 에러(INVALID_CREDENTIALS)는 직렬화 안전 Result.Failure로 돌아온다. free-text message는 절대 클라이언트로 넘어가지 않는다.",
  },
  {
    href: "/demo/query-retry",
    title: "쿼리 트랙 · networkBoundary + TanStack",
    badge: "Client Query",
    desc: "networkBoundary가 raw transport를 AppError로 변환(8개 코드의 유일 생산자). makeQueryClient가 catalog defaultRetryable을 배선 → 404는 재시도 안 하고, 429/5xx는 Retry-After/백오프로 재시도. 실패는 handleError → decision.user → Presenter 토스트.",
  },
  {
    href: "/demo/boundaries",
    title: "인터럽트 바운더리 · raise()",
    badge: "RSC Interrupt",
    desc: "쿼리의 expected 에러를 Next 프레임워크 인터럽트로 변환: NOT_FOUND→notFound(), FORBIDDEN→forbidden(), 그리고 unexpected fault→error.tsx 렌더링 경계.",
  },
  {
    href: "/demo/server-retry",
    title: "서버 재시도 · withRetry",
    badge: "Server Action",
    desc: "서버측 DAL 재시도. withRetry가 retryable 플래그와 Retry-After 힌트를 존중해 운영성 에러만 백오프로 재시도하고, non-retryable 코드는 즉시 전파한다. 클라 쿼리 재시도와 함께 2-트랙을 완성.",
  },
];

export default function Home() {
  return (
    <div className="container">
      <h1>통합 에러 시스템</h1>
      <p className="muted">
        Turborepo · pnpm 모노레포. <code>error-core</code> / <code>error-adapters</code> /{" "}
        <code>error-next</code> 패키지를 소비하는 Next.js 16 레퍼런스 앱.
      </p>

      <div className="card">
        <h3>아키텍처 한눈에</h3>
        <pre>{`error-core      zod만 의존 · isomorphic 커널
  └ 레지스트리(SSOT) · 정책 해소 · 정규화 · 직렬화 누출 게이트
    텔레메트리 계약 · 순수 재시도 · networkBoundary · 클라 싱글턴 sink

error-adapters  벤더 격리 (optional peerDeps)
  └ Sentry(reporter) · sonner(presenter) · pager(notifier)

error-next      Next/React 통합 (peerDeps: next, react, @tanstack)
  └ safeServerAction/safeFormAction · raise · 요청별 컴포지션 루트
    useErrorHandler · QueryClient · ErrorFallback / ErrorHandlerInit
  · 클라 표면: import { … } from "error-next"
  · 서버 표면: import { … } from "error-next/server"`}</pre>
        <p className="muted">
          소비자가 보는 공개 표면은 단 2개(클라이언트 배럴 + 서버 배럴). 나머지는 내부 구현이며
          deep import(<code>error-core/decision/app-error</code> 등)도 가능하다.
        </p>
      </div>

      {demos.map((d) => (
        <div className="card" key={d.href}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3 style={{ margin: 0 }}>
              <Link href={d.href}>{d.title}</Link>
            </h3>
            <span className="badge">{d.badge}</span>
          </div>
          <p className="muted" style={{ marginBottom: 0 }}>
            {d.desc}
          </p>
        </div>
      ))}

      <div className="card">
        <h3>관측 가능성</h3>
        <p className="muted" style={{ marginBottom: 8 }}>
          proxy.ts가 모든 요청에 <code>x-request-id</code>를 심고(상관관계 ID), 응답 헤더 +
          비-httpOnly 쿠키로 클라이언트까지 전파한다. 텔레메트리 헬스 프로브:
        </p>
        <Link href="/api/health">
          <code>GET /api/health</code>
        </Link>{" "}
        <span className="muted">— dead-man&apos;s-switch (삼켜진 sink 실패 임계 초과 시 503)</span>
      </div>
    </div>
  );
}
