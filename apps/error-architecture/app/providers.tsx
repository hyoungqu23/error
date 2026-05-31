"use client";

// app/providers.tsx — 클라이언트 프로바이더 셸.
// TanStack QueryClient(에러코어의 retryable 배선이 반영된 makeQueryClient),
// 클라 sink 부트스트랩(ErrorInit), sonner Toaster를 한 곳에서 마운트한다.

import { useState, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { makeQueryClient } from "error-next";
import { Toaster } from "sonner";
import { ErrorInit } from "./error-init";

export function Providers({
  correlationId,
  children,
}: {
  correlationId: string;
  children: ReactNode;
}) {
  // QueryClient는 한 번만 생성(렌더마다 새로 만들면 캐시가 날아간다).
  const [queryClient] = useState(() => makeQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <ErrorInit correlationId={correlationId} />
      {children}
      <Toaster position="top-right" richColors closeButton />
    </QueryClientProvider>
  );
}
