// ============================================================================
// error/use-error-handler.ts  — §8.2  ('use client')
// Interaction-layer entry point: runs the single processing path (handleError),
// then performs the navigation/escalation UX off the resolved decision.
//   - surface "redirect" (or action "login") → router.push(target+returnTo) (G9 seam)
//   - surface "page"     → navigate to a dedicated route if mapped (FORBIDDEN → /403),
//                          else RE-THROW the normalized AppError so the nearest
//                          error.tsx renders the full-page state.
//
// 기본 uiScope 계약(이벤트 핸들러 안전): 이 훅이 반환하는 콜백은 거의 전적으로 React
// 이벤트 핸들러(onClick 등)에서 호출된다 — 그 콜백의 동기 throw는 error.tsx로 라우팅되지
// 않으므로(미처리 예외 = UI 없는 화면 깨짐), 호출자가 occurrence.uiScope를 명시하지 않으면
// "component"를 기본 주입한다. 그러면 resolve가 page 에스컬레이션 대신 toast/inline을 골라
// throw 경로를 타지 않는다(handler.ts FALLBACK_OCCURRENCE.uiScope="page"는 그대로 — window.onerror
// 등 비-훅 boundary는 page가 옳다; 기본값 결정은 훅 레벨에만 둔다).
// page 에스컬레이션(error.tsx로의 의도된 re-throw)이 필요하면 호출자가 occurrence.uiScope="page"를
// 명시한다 — render 경로(throw가 실제로 React에 surface되는 곳) 전용 opt-in이다.
// 단 action==="login"(AUTH_REQUIRED)·surface==="redirect" 내비게이션은 surface와 독립적으로
// 아래 분기가 보존하므로, 기본값이 component여도 로그인 리다이렉트 UX는 그대로다.
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
 * NOTE: a re-throw escalation only reaches error.tsx if surface resolves to "page",
 * which requires an EXPLICIT occurrence.uiScope="page" from the caller (render-path
 * opt-in). The default-injected "component" scope never resolves to "page", so the
 * throw branch below is unreachable unless the caller asked for it. For codes with a
 * dedicated full-page route (PAGE_ROUTE_BY_CODE) the navigation still wins over throw.
 */
export const useErrorHandler = () => {
  const router = useRouter();
  return useCallback(
    (input: unknown, opts?: HandleErrorOptions): DecisionFailure => {
      // 이벤트-핸들러 안전 기본값: 호출자가 uiScope를 명시하지 않은 경우에만 "component"를
      // 채운다. 명시한 값(특히 "page")은 절대 덮어쓰지 않는다 — render 경로 escalation 의도 보존.
      // opts의 다른 필드(telemetry/ctx/fallbackMessage)와 occurrence의 다른 키는 그대로 전달한다.
      const opts2: HandleErrorOptions =
        opts?.occurrence?.uiScope === undefined
          ? { ...opts, occurrence: { ...opts?.occurrence, uiScope: "component" } }
          : opts;
      const result = handleError(input, opts2);
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
