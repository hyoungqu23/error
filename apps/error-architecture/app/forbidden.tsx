// app/forbidden.tsx — FORBIDDEN 인터럽트 경계(experimental.authInterrupts).
// raise({ code: "FORBIDDEN" }) → forbidden()이 호출되면 403 UI로 이 페이지가 렌더된다.
import Link from "next/link";

export default function Forbidden() {
  return (
    <div className="container">
      <div className="card">
        <span className="badge err">403 · FORBIDDEN</span>
        <h2>접근 권한이 없습니다.</h2>
        <p className="muted">
          <code>raise()</code>가 비즈니스 FORBIDDEN 에러를 Next의{" "}
          <code>forbidden()</code> 인터럽트로 변환했습니다. (requiredRole 같은 내부 정보는
          클라이언트로 누출되지 않습니다.)
        </p>
        <Link href="/">← 홈으로</Link>
      </div>
    </div>
  );
}
