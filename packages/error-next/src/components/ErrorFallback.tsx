"use client";

// components/ErrorFallback.tsx — the shared rendering-boundary fallback UI (§6.1).
// Reconciles the v16.1 `{ error, reset }` contract with the promoted `unstable_retry`:
// support BOTH. `unstable_retry` (re-fetch + re-render) is preferred over `reset`
// (re-render only); when only `reset` is present we ALSO `router.refresh()` so the RSC
// payload is re-fetched on Next 15 (reset alone only re-renders the boundary); if
// neither is provided we degrade to a hard reload. Because the `unstable_` API may be
// renamed across Next versions, the difference is abstracted here so a rename is a
// one-file change — and `unstable_retry` is typed as our OWN optional prop (NOT imported
// from `next`), matching this runtime's surface.
//
// G11: (a) the role="alert" container is focused on mount for screen-reader/keyboard
// users; (b) retry runs inside useTransition so the button shows a pending/disabled
// state; (c) reset-only refetches via router.refresh()+reset(); (d) the retry affordance
// is hidden for non-retryable codes; (e) the report effect is wrapped in try/catch so
// global-error.tsx never throws if the client singleton is uninitialized.

import { useContext, useEffect, useRef, useTransition } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { resolveErrorMessage } from "error-core/translator";
import { handleError } from "error-core/handler";
import {
  isAppError,
  isKnownErrorCode,
  retryAfterHintFromError,
  CANONICAL_ERROR_SEMANTICS,
} from "error-core";

type RetryProp = { unstable_retry?: () => void; reset?: () => void };

export function ErrorFallback({
  error,
  unstable_retry,
  reset,
  minimal = false,
}: { error: Error & { digest?: string } } & RetryProp & { minimal?: boolean }) {
  // Read the App Router context directly rather than via useRouter(): useRouter()
  // THROWS when no AppRouterContext is mounted (e.g. global-error.tsx, which replaces
  // the root layout, and unit renders). The context is null there — we degrade the
  // RSC refetch to a no-op and still re-render via reset().
  const router = useContext(AppRouterContext);
  const alertRef = useRef<HTMLDivElement>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    // (e) global-error.tsx renders this when the root layout (and the client singleton
    // init) is bypassed; handleError() throws if initHandleError() never ran. Swallow it
    // so the fallback still renders real copy instead of cascading into a render crash.
    try {
      // telemetry suppressed → already reported at the server/network boundary (no duplicate).
      // `route` is folded into the per-call TelemetryContext via `ctx`.
      handleError(error, {
        telemetry: { capture: false, breadcrumb: false, alert: false },
        ctx: { route: location.pathname },
      });
    } catch {
      // intentionally silent — the boundary's job is to RENDER, not to re-report.
    }
  }, [error]);

  // (a) move focus to the alert region on mount so AT announces it and keyboard
  // users land on the recovery affordance.
  useEffect(() => {
    alertRef.current?.focus();
  }, []);

  // (c) Retry source reconciliation. unstable_retry (refetch+rerender) wins. Otherwise
  // reset-only: refresh the RSC payload THEN re-render the boundary. router may be null
  // outside an App Router context (e.g. unit render) — optional-chain so reset() still
  // runs. Last resort: a hard reload.
  const retry = () => {
    if (unstable_retry) {
      unstable_retry();
      return;
    }
    if (reset) {
      router?.refresh(); // re-fetch server data (Next 15: reset() alone only re-renders)
      reset();
      return;
    }
    location.reload();
  };

  // (b) run retry inside a transition so the button can reflect a pending/disabled state.
  const onRetry = () => startTransition(retry);

  // For RSC prod errors the raw `error.message` is a placeholder. Prefer the catalog
  // defaultMessageKey resolved to copy; otherwise a static localized line. The
  // provider-free `resolveErrorMessage` never returns the raw key and never throws,
  // so both the normal (`error.tsx`) and `minimal` (`global-error.tsx`) paths render
  // real copy without any React context translator.
  // {seconds} 보간(P2 리뷰): RATE_LIMITED가 이 경계에 도달해도 리터럴 토큰이 아니라
  // 카운트다운이 렌더되도록 retryAfterMs 힌트에서 vars를 도출한다(resolve §5.4와 동일 규칙).
  const retryHint = isAppError(error) ? retryAfterHintFromError(error) : undefined;
  const title =
    isAppError(error) && isKnownErrorCode(error.code)
      ? resolveErrorMessage(
          CANONICAL_ERROR_SEMANTICS[error.code].defaultMessageKey,
          null,
          retryHint !== undefined ? { seconds: Math.ceil(retryHint / 1000) } : undefined,
        )
      : resolveErrorMessage("error.unknown");

  // (d) only offer a retry when a retry is meaningful. A known AppError uses its catalog
  // `defaultRetryable`; a non-AppError (raw render crash) is always offered the affordance
  // (reset/reload may recover a transient render fault).
  // fall-closed: 카탈로그 밖 코드를 단 AppError는 재시도 의미를 보장할 수 없으므로 숨긴다
  // (구 모델의 UNKNOWN_* fallback retryable:false와 동일 거동).
  const canRetry = isAppError(error)
    ? isKnownErrorCode(error.code) && CANONICAL_ERROR_SEMANTICS[error.code].defaultRetryable
    : true;

  return (
    <div role="alert" ref={alertRef} tabIndex={-1}>
      <h2>{title}</h2>
      {!minimal && <p>잠시 후 다시 시도해주세요.</p>}
      {error.digest && (
        <p style={{ opacity: 0.5, fontSize: 12 }}>ref: {error.digest}</p>
      )}
      {canRetry && (
        <button onClick={onRetry} disabled={isPending}>
          다시 시도
        </button>
      )}
    </div>
  );
}
