import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 워크스페이스 패키지는 raw-TS로 배포(빌드 단계 없음)되므로 앱 번들러가 트랜스파일한다.
  transpilePackages: ["error-core", "error-adapters", "error-next"],
  experimental: {
    // raise()가 사용하는 forbidden()/unauthorized() 인터럽트를 활성화한다(forbidden.tsx/unauthorized.tsx).
    authInterrupts: true,
  },
};

export default nextConfig;
