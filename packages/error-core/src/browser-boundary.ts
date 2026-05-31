// ============================================================================
// error/browser-boundary.ts — 브라우저 경계 (final safety net) (§8.3)
// window.onerror / onunhandledrejection can fire hundreds of times a second on a
// render loop, so each path tags its route to engage the Sentry storm throttle.
// ============================================================================
import { handleError } from "./handler";

export const initBrowserBoundary = (): void => {
  if (typeof window === "undefined") return;
  window.onerror = (_m, _s, _l, _c, error) =>
    void handleError(error ?? new Error("Unhandled (window.onerror)"), {
      present: "toast",
      log: "error",
      ctx: { route: "window.onerror" },
    });
  window.onunhandledrejection = (ev: PromiseRejectionEvent) =>
    void handleError(ev.reason ?? new Error("Unhandled rejection"), {
      present: "toast",
      log: "error",
      ctx: { route: "window.onunhandledrejection" },
    });
};
