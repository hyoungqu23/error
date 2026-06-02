// ============================================================================
// error/browser-boundary.ts — 브라우저 경계 (final safety net) (§8.3)
// window.onerror / onunhandledrejection can fire hundreds of times a second on a
// render loop, so each path tags its route to engage the Sentry storm throttle.
// ============================================================================
import { handleError } from "./handler";

export const initBrowserBoundary = (): (() => void) => {
  if (typeof window === "undefined") return () => {};

  const onError = (event: ErrorEvent): void => {
    handleError(event.error ?? new Error("Unhandled (window.onerror)"), {
      ctx: { route: "window.onerror" },
    });
  };
  const onUnhandledRejection = (event: PromiseRejectionEvent): void => {
    handleError(event.reason ?? new Error("Unhandled rejection"), {
      ctx: { route: "window.onunhandledrejection" },
    });
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);

  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
  };
};
