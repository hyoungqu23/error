"use client";

// app/demo/boundaries/crash/page.tsx — 의도적 렌더 크래시로 error.tsx 렌더링 경계 시연.
// throw된 비-DomainError는 error.tsx의 ErrorFallback에서 UNKNOWN_CLIENT_ERROR로 정규화되고,
// 재시도(reset)가 제공된다. handleError는 log:"none"으로 호출되어 중복 보고하지 않는다.
import { useState } from "react";
import Link from "next/link";

export default function CrashDemo() {
  const [boom, setBoom] = useState(false);

  if (boom) {
    throw new Error("의도적 렌더 크래시 — 가장 가까운 error.tsx가 잡는다");
  }

  return (
    <div className="container">
      <p>
        <Link href="/">← 홈</Link> · <Link href="/demo/boundaries">← 바운더리</Link>
      </p>
      <h1>unexpected fault → error.tsx</h1>
      <div className="card">
        <p className="muted">
          아래 버튼은 렌더 도중 throw한다. React가 가장 가까운 error.tsx로 폴백하고, 공유
          ErrorFallback이 정규화된 메시지와 재시도 버튼을 보여준다.
        </p>
        <button className="danger" onClick={() => setBoom(true)}>
          렌더 중 throw
        </button>
      </div>
    </div>
  );
}
