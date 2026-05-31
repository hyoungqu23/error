import type { ReactNode } from "react";
import type { Metadata } from "next";
import { getRequestCorrelationId } from "error-next/server";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "에러 아키텍처 — error-core 모노레포",
  description:
    "error-core / error-adapters / error-next 패키지를 소비하는 Next.js 16 레퍼런스 앱. 통합 에러 시스템의 경계·트랙·바운더리를 시연한다.",
};

// 루트 레이아웃(서버 컴포넌트). proxy.ts가 INBOUND 헤더에 심은 x-request-id를
// 요청 범위 correlationId로 읽어(React cache로 요청당 1회) 클라 sink에 시드한다.
export default async function RootLayout({ children }: { children: ReactNode }) {
  const correlationId = await getRequestCorrelationId();
  return (
    <html lang="ko">
      <body>
        <Providers correlationId={correlationId}>{children}</Providers>
      </body>
    </html>
  );
}
