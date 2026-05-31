// ============================================================================
// error/use-error-handler.ts  — §8.2  ('use client')
// Interaction-layer entry point: runs the single processing path (handleError),
// then performs the navigation/escalation UX the Presenter cannot.
//   - "redirect" → router.push("/login?returnTo=<current path+search>") (G9 seam)
//   - "page"     → navigate to a dedicated route if mapped (FORBIDDEN → /403),
//                  else RE-THROW the normalized DomainError so the nearest
//                  error.tsx renders the full-page state.
// ============================================================================
"use client";
import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { handleError } from "error-core/handler";
import type { HandleErrorOptions } from "error-core/handle-error";
import type { ResolvedAppError } from "error-core/app-error";
import type { PresentAction } from "error-core/policy";
import type { ErrorCode } from "error-core/registry";

/**
 * Optional dedicated-route map for the "page" PresentAction. A code present here
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
    (input: unknown, opts?: HandleErrorOptions): ResolvedAppError => {
      const result = handleError(input, opts);
      const present: PresentAction = result.policy.present; // effective action (folds in per-call override)

      if (present === "redirect") {
        // G9: preserve the page the user was on so post-login can bounce back.
        // The server raise() cannot read client location, so the returnTo is appended HERE.
        const returnTo = encodeURIComponent(location.pathname + location.search);
        router.push("/login?returnTo=" + returnTo);
        return result;
      }
      if (present === "page") {
        const route = PAGE_ROUTE_BY_CODE[result.code];
        if (route) {
          router.push(route); // dedicated full-page route (e.g. FORBIDDEN → /403)
        } else {
          throw result.error; // escalate to nearest error.tsx (normalized instance)
        }
      }
      // caller switches on result.code for in-place UI when present is toast/alert/inline/silent
      return result;
    },
    [router],
  );
};
