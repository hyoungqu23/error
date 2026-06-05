"use client";

// app/error-init.tsx — 클라이언트 싱글턴 sink 부트스트랩(§8.1).
// app/layout.tsx에서 1회 마운트한다. proxy.ts가 심은 correlationId를 받아
// initHandleError로 클라 deps(컴포지션 루트)를 바인딩하고, window.onerror /
// onunhandledrejection 최후 안전망을 건다. 모두 useEffect 안 — 렌더 중이 아니다.

import { useEffect } from "react";
import { initHandleError, initBrowserBoundary } from "error-core";
import { buildClientDeps } from "@/lib/composition-root";

export function ErrorInit({ correlationId }: { correlationId: string }) {
  useEffect(() => {
    initHandleError(buildClientDeps(), { correlationId });
    return initBrowserBoundary();
  }, [correlationId]);
  return null;
}
