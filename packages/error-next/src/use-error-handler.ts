// ============================================================================
// error/use-error-handler.ts  — §8.2  ('use client')
// Interaction-layer entry point: runs the single processing path (handleError),
// then performs the navigation/escalation UX off the resolved decision.
//   - surface "redirect" (or action "login") → router.push(target+returnTo) (G9 seam)
//   - surface "page"     → navigate to a dedicated route if mapped (FORBIDDEN → /403),
//                          else RE-THROW the normalized AppError so the nearest
//                          error.tsx renders the full-page state.
// ============================================================================
"use client";
import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { handleError } from "error-core/handler";
import type { HandleErrorOptions } from "error-core/handle-error";
import type { DecisionFailure, ErrorCode } from "error-core";

/**
 * Optional dedicated-route map for the "page" ErrorSurface. A code present here
 * NAVIGATES to its route instead of re-throwing into the nearest error.tsx.
 * Inlined (no separate page-routes module) so this file references nothing it
 * does not define or import from a mapped path.
 */
const PAGE_ROUTE_BY_CODE: Partial<Record<ErrorCode, string>> = {
  FORBIDDEN: "/403",
};

/**
 * NOTE: a re-throw escalation only reaches error.tsx if this handler is invoked
 * during render or inside a path React surfaces. For pure event handlers, prefer
 * the dedicated-route navigation (PAGE_ROUTE_BY_CODE).
 */
export const useErrorHandler = () => {
  const router = useRouter();
  return useCallback(
    (input: unknown, opts?: HandleErrorOptions): DecisionFailure => {
      const result = handleError(input, opts);
      const surface = result.decision.user.surface; // resolved ErrorSurface (folds in per-call override)

      // G9 + catalog 의도 보존: surface가 redirect이거나, occurrence에 따라 surface가 달라도
      // 결정된 action이 "login"(AUTH_REQUIRED의 defaultAction)이면 로그인으로 보낸다 — 구 모델
      // (정적 present:"redirect")의 자동 리다이렉트 UX를 컨텍스트 변화로 잃지 않는다.
      if (surface === "redirect" || result.decision.user.action === "login") {
        // preserve the page the user was on so post-login can bounce back.
        // The server raise() cannot read client location, so the returnTo is appended HERE.
        const returnTo = encodeURIComponent(location.pathname + location.search);
        router.push((result.decision.user.target ?? "/login") + "?returnTo=" + returnTo);
        return result;
      }
      if (surface === "page") {
        const route = PAGE_ROUTE_BY_CODE[result.error.code as ErrorCode];
        if (route) {
          router.push(route); // dedicated full-page route (e.g. FORBIDDEN → /403)
        } else {
          throw result.error; // escalate to nearest error.tsx (normalized instance)
        }
      }
      // caller switches on result.error.code for in-place UI when surface is toast/dialog/inline/silent
      return result;
    },
    [router],
  );
};
