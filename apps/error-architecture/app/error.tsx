"use client";

// app/error.tsx — 세그먼트 렌더링 경계(렌더링 경계).
// Next는 { error, reset }로 호출하며, 이 런타임은 승격된 `unstable_retry`도 넘긴다.
// `unstable_retry`는 next가 아니라 우리 자체 optional prop으로 타이핑하고, 전부
// error-next의 공유 ErrorFallback에 위임한다(retry 소스 조정 unstable_retry ?? reset ?? reload).

import { ErrorFallback } from "error-next";

export default function Error(props: {
  error: Error & { digest?: string };
  reset: () => void;
  unstable_retry?: () => void;
}) {
  return (
    <div className="container">
      <div className="card">
        <ErrorFallback {...props} />
      </div>
    </div>
  );
}
