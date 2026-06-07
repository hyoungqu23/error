"use client";

// app/demo/query-retry/page.tsx — 쿼리 트랙.
// networkBoundary(throwing 변환)를 queryFn으로 쓰고, makeQueryClient가 깐 catalog defaultRetryable
// 배선이 재시도를 좌우한다. 실패한 AppError는 useErrorHandler(telemetry)로 흘리고, 반환된
// decision.user를 presentFailure(컴포지션 루트의 sonner Presenter 배선)로 토스트한다 — 신 모델의
// "telemetry는 파이프라인, presentation은 소비자" 시연.
import { useState } from "react";
import Link from "next/link";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import {
  networkBoundary,
  useErrorHandler,
  resolveErrorMessage,
  isAppError,
  isKnownErrorCode,
  CANONICAL_ERROR_SEMANTICS,
} from "error-next";
import { presentFailure } from "@/lib/composition-root";

const DocSchema = z.object({
  id: z.string(),
  title: z.string(),
  items: z.array(z.string()),
});
type Doc = z.infer<typeof DocSchema>;

const MODES = [
  { key: "ok", label: "정상(200)" },
  { key: "notfound", label: "NOT_FOUND(404·재시도 X)" },
  { key: "ratelimit", label: "RATE_LIMITED(429·Retry-After)" },
  { key: "server", label: "HTTP_SERVER_ERROR(500·재시도)" },
] as const;

export default function QueryRetryDemo() {
  const [mode, setMode] = useState<string>("ok");
  const handleError = useErrorHandler();

  const query = useQuery<Doc>({
    queryKey: ["flaky", mode],
    queryFn: ({ signal }) =>
      networkBoundary<Doc>(`/api/flaky?mode=${mode}`, { schema: DocSchema, signal }),
    // retry/retryDelay는 makeQueryClient 기본값(shouldRetryQuery: retryable && <3)을 따른다.
    retryOnMount: false,
  });

  const error = query.error;
  // isAppError가 null/비-AppError를 한 번에 거른다(narrow). 메시지는 catalog defaultMessageKey 해소.
  const appErr = isAppError(error) ? error : undefined;
  const errorCode = appErr?.code;
  const errorMsg =
    appErr && isKnownErrorCode(appErr.code)
      ? resolveErrorMessage(CANONICAL_ERROR_SEMANTICS[appErr.code].defaultMessageKey)
      : undefined;

  return (
    <div className="container">
      <p>
        <Link href="/">← 홈</Link>
      </p>
      <h1>쿼리 트랙 · networkBoundary + TanStack</h1>
      <p className="muted">
        모드를 바꾸면 <code>/api/flaky</code>가 다른 응답을 준다. NOT_FOUND는 재시도하지 않고,
        429/500은 백오프로 재시도한다(failureCount로 확인).
      </p>

      <div className="card">
        <div className="row">
          {MODES.map((m) => (
            <button
              key={m.key}
              className={mode === m.key ? "" : "secondary"}
              onClick={() => setMode(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          <button onClick={() => query.refetch()} disabled={query.isFetching}>
            {query.isFetching ? "요청 중…" : "다시 요청"}
          </button>
          <span className="muted">failureCount: {query.failureCount}</span>
        </div>
      </div>

      <div className="card">
        {query.isPending && <p className="muted">로딩…</p>}

        {query.isSuccess && (
          <div>
            <span className="badge ok">200 OK</span>
            <pre>{JSON.stringify(query.data, null, 2)}</pre>
          </div>
        )}

        {query.isError && (
          <div>
            <span className="badge err">{errorCode ?? "ERROR"}</span>
            <p style={{ marginTop: 12 }}>{errorMsg ?? "알 수 없는 오류"}</p>
            <p className="muted" style={{ fontSize: 12 }}>
              correlationId: {appErr?.correlationId ?? "—"}
            </p>
            <button
              className="danger"
              onClick={() =>
                // 이 버튼은 페이지 전환이 아니라 인라인 위젯의 에러 — occurrence를 component
                // scope로 두면 resolve가 page 에스컬레이션 대신 toast/inline을 고른다. (이제
                // useErrorHandler의 기본값이기도 하다 — 미명시 시 component가 주입되어 이벤트
                // 핸들러 throw 함정을 막는다. 여기선 interaction:"query"도 함께 명시한다.)
                presentFailure(
                  handleError(error, {
                    occurrence: { interaction: "query", uiScope: "component" },
                  }),
                )
              }
            >
              이 에러를 핸들러로 보내기 (telemetry → decision.user → surface별 토스트/인라인)
            </button>
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              NOT_FOUND(business)·HTTP_SERVER_ERROR(fault)는 surface:&quot;inline&quot; → 토스트가
              뜨지 않는다. NETWORK/RATE_LIMITED(operational·retryable)는 surface:&quot;toast&quot;.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
