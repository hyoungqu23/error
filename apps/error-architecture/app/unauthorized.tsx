// app/unauthorized.tsx — UNAUTHORIZED 인터럽트 경계(experimental.authInterrupts).
// unauthorized()가 호출되면 401 UI로 렌더된다. (AUTH_REQUIRED 비즈니스 에러의 서버측 표면)
import Link from "next/link";

export default function Unauthorized() {
  return (
    <div className="container">
      <div className="card">
        <span className="badge err">401 · UNAUTHORIZED</span>
        <h2>로그인이 필요합니다.</h2>
        <p className="muted">
          인증되지 않은 접근입니다. 클라이언트 트랙에서는 AUTH_REQUIRED가{" "}
          <code>present:&quot;redirect&quot;</code>로 로그인 페이지로 보냅니다.
        </p>
        <Link href="/">← 홈으로</Link>
      </div>
    </div>
  );
}
