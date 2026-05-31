// app/not-found.tsx — NOT_FOUND 인터럽트 경계.
// raise({ code: "NOT_FOUND" }) 또는 notFound()가 호출되면 이 페이지가 렌더된다.
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="container">
      <div className="card">
        <span className="badge err">404 · NOT_FOUND</span>
        <h2>요청하신 내용을 찾을 수 없습니다.</h2>
        <p className="muted">
          쿼리 트랙의 expected 에러가 <code>raise()</code>를 통해 Next의{" "}
          <code>notFound()</code> 인터럽트로 변환된 결과입니다.
        </p>
        <Link href="/">← 홈으로</Link>
      </div>
    </div>
  );
}
