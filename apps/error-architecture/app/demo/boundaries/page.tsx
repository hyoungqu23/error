import Link from "next/link";

// app/demo/boundaries/page.tsx — 인터럽트 바운더리 데모 인덱스(서버 컴포넌트).
// 각 하위 라우트는 서버에서 raise()로 expected 에러를 Next 인터럽트로 변환하거나,
// 클라이언트에서 의도적으로 throw해 error.tsx 렌더링 경계를 띄운다.

const cases = [
  {
    href: "/demo/boundaries/not-found",
    title: "NOT_FOUND → notFound()",
    desc: "서버 RSC에서 raise(NOT_FOUND) → not-found.tsx(404).",
  },
  {
    href: "/demo/boundaries/forbidden",
    title: "FORBIDDEN → forbidden()",
    desc: "서버 RSC에서 raise(FORBIDDEN) → forbidden.tsx(403). requiredRole은 누출 안 됨.",
  },
  {
    href: "/demo/boundaries/crash",
    title: "unexpected fault → error.tsx",
    desc: "클라이언트 렌더 중 throw → 가장 가까운 error.tsx(공유 ErrorFallback, 재시도 제공).",
  },
];

export default function BoundariesDemo() {
  return (
    <div className="container">
      <p>
        <Link href="/">← 홈</Link>
      </p>
      <h1>인터럽트 바운더리 · raise()</h1>
      <p className="muted">
        쿼리/읽기 코드는 <code>raise(error)</code>만 호출하면 된다. code에 따라 올바른 Next
        인터럽트(notFound/redirect/forbidden)로 변환되고, 그 외는 error.tsx로 throw된다.
      </p>
      {cases.map((c) => (
        <div className="card" key={c.href}>
          <h3 style={{ marginTop: 0 }}>
            <Link href={c.href}>{c.title}</Link>
          </h3>
          <p className="muted" style={{ marginBottom: 0 }}>
            {c.desc}
          </p>
        </div>
      ))}
    </div>
  );
}
