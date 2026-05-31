"use client";

// app/global-error.tsx — 루트 경계. 루트 레이아웃을 대체하므로 자체 <html><body>를 갖고
// 프로바이더를 마운트하지 않는다(§6.1). ErrorFallback을 `minimal`로 렌더 → 프로바이더
// 없는 해소 경로(co-located 폴백 맵, context translator 없음)를 강제한다.

import { ErrorFallback } from "error-next";

export default function GlobalError(props: {
  error: Error & { digest?: string };
  reset: () => void;
  unstable_retry?: () => void;
}) {
  return (
    <html lang="ko">
      <body>
        <div className="container">
          <div className="card">
            <ErrorFallback {...props} minimal />
          </div>
        </div>
      </body>
    </html>
  );
}
