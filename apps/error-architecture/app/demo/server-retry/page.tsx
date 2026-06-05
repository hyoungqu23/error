"use client";

// app/demo/server-retry/page.tsx — withRetry 서버 재시도 시연.
// 서버 액션이 flaky 업스트림을 withRetry로 감싸 retryable 에러를 자동 재시도하고,
// 몇 번째 시도에 성공했는지(attempts) 돌려준다. 클라이언트 쿼리 재시도(/demo/query-retry)와
// 함께 2-트랙 재시도 그림을 완성한다.
import { useState, useTransition } from "react";
import Link from "next/link";
import { runWithRetryDemo, type ServerRetryResult } from "./actions";

export default function ServerRetryDemo() {
  const [result, setResult] = useState<ServerRetryResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const run = () => {
    startTransition(async () => {
      setResult(await runWithRetryDemo());
    });
  };

  return (
    <div className="container">
      <p>
        <Link href="/">← 홈</Link>
      </p>
      <h1>서버 재시도 · withRetry</h1>
      <p className="muted">
        서버 액션이 <code>withRetry(() =&gt; flakyUpstream())</code>로 flaky 업스트림(처음 두 번은
        503 HTTP_SERVER_ERROR)을 감싼다. HTTP_SERVER_ERROR는 retryable:true → 풀-지터 백오프로
        재시도 → 3번째 시도에 성공한다.
      </p>

      <div className="card">
        <button onClick={run} disabled={isPending}>
          {isPending ? "재시도 중…" : "업스트림 호출 (withRetry)"}
        </button>

        {result?.ok && (
          <p style={{ color: "var(--ok)", marginTop: 16 }}>
            <span className="badge ok">성공</span> {result.value} — {result.attempts}번째 시도에 성공
          </p>
        )}
        {result && !result.ok && (
          <p className="field-error" style={{ marginTop: 16 }}>
            실패: {result.code}
          </p>
        )}
      </div>

      <div className="card">
        <h3 className="muted" style={{ marginTop: 0 }}>이 데모가 보여주는 것</h3>
        <ul className="muted">
          <li>withRetry는 catalog defaultRetryable(카탈로그 SSOT)을 존중 — 재시도 가능한 코드만 재시도</li>
          <li>NOT_FOUND/VALIDATION 같은 non-retryable 코드와 non-AppError는 즉시 전파</li>
          <li>RATE_LIMITED의 Retry-After 힌트가 있으면 백오프 대신 그 값을 사용(maxMs로 클램프)</li>
        </ul>
      </div>
    </div>
  );
}
