// ============================================================================
// error/handler.ts  (client singleton)  — §8.1
// Module-slot singleton: initHandleError builds the decision-model handler once at
// startup; handleError/setErrorUser are the re-exported sink. No active-registry binding
// — the injected DecisionSystem owns all policy (P3b-ii).
// ============================================================================
import { createHandleError, type HandleErrorOptions } from "./handle-error";
import type { HandleErrorDeps } from "./types";
import type { DecisionFailure } from "./decision/system";
import type { TelemetryContext, OccurrenceContext } from "./decision/types";

let _handle: ((input: unknown, opts?: HandleErrorOptions) => DecisionFailure) | null = null;
let _user: { id: string; role?: string } | null = null;

/** The catch-all occurrence used when a boundary did not supply its own. */
const FALLBACK_OCCURRENCE: OccurrenceContext = {
  operation: "unknown",
  interaction: "event-handler",
  uiScope: "page",
  criticality: "normal",
};

export interface InitHandleErrorOptions {
  correlationId?: string;
  baseCtx?: Partial<TelemetryContext>;
  baseOccurrence?: OccurrenceContext;
}

export const initHandleError = (deps: HandleErrorDeps, options: InitHandleErrorOptions = {}): void => {
  const baseCtx: TelemetryContext = {
    runtime: "client",
    operation: "unknown",
    user: _user,
    ...(options.correlationId !== undefined ? { correlationId: options.correlationId } : {}),
    ...options.baseCtx,
  };
  const baseOccurrence = options.baseOccurrence ?? FALLBACK_OCCURRENCE;
  _handle = createHandleError(
    deps.system,
    { reporter: deps.reporter, notifier: deps.notifier },
    baseCtx,
    baseOccurrence,
  );
};

export const handleError = (input: unknown, opts?: HandleErrorOptions): DecisionFailure => {
  if (!_handle) {
    // dev guard — initHandleError() must run once at startup (ErrorHandlerInit).
    throw new Error(
      "initHandleError() not called: mount <ErrorHandlerInit /> once in app/layout.tsx before using handleError().",
    );
  }
  // P2(리뷰 ×5 패스): user는 호출 시점에 주입 — init 시 캡처만 하면 로그인 후 setErrorUser가
  // 이미 빌드된 클로저(baseCtx.user)에 닿지 못해 텔레메트리가 영원히 익명이었다.
  // 호출자가 opts.ctx.user를 명시하면 그쪽이 이긴다(스프레드 순서).
  return _handle(input, { ...opts, ctx: { user: _user, ...opts?.ctx } });
};

/** 로그인/로그아웃 시 호출 — 이후의 모든 handleError ctx.user에 즉시 반영된다. */
export const setErrorUser = (user: { id: string; role?: string } | null): void => {
  _user = user;
};
