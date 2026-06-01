// error/handle-error.ts  — resolves ALL policy off the INJECTED registry; returns ResolvedAppError.
import { DomainError, resolvePolicy, type ResolvedAppError } from "./app-error";
import { normalizeToDomainError } from "./normalize";
import type { HandleErrorDeps } from "./types";
import type { TelemetryContext } from "./telemetry";
import type { PresentAction, LogLevel } from "./policy";
import type { Severity } from "./severity";

export interface HandleErrorOptions {
  present?: PresentAction;
  log?: LogLevel;
  /** Override the resolved severity for this call (rare; e.g. demote a known-noisy code). */
  severity?: Severity;
  fallbackMessage?: string;
  ctx?: Partial<TelemetryContext>;
}

const guardSink = (fn: () => void): void => {
  try {
    fn();
  } catch {
    // Error handling must never become the error source. Production visibility
    // still belongs in guardedCompositeReporter / pager transports.
  }
};

export const createHandleError =
  (deps: HandleErrorDeps, baseCtx: TelemetryContext) =>
  (input: unknown, options: HandleErrorOptions = {}): ResolvedAppError => {
    const error = normalizeToDomainError(input, options.fallbackMessage, baseCtx.correlationId);
    // Resolve ALL seven policy fields off the INJECTED registry, honoring instance
    // overrides. Same source the getters read (active registry IS deps.registry once bound).
    const base = resolvePolicy(deps.registry, error.code, {
      severity: (error as DomainError).severity,
      retryable: (error as DomainError).retryable,
    });
    const present: PresentAction = options.present ?? base.present; // per-call override wins
    const log: LogLevel = options.log ?? base.log;
    // severity drives BOTH the Sentry level (via report) and the alerting gate (via notify).
    // options.severity wins; else the instance/registry-resolved severity.
    const severity: Severity = options.severity ?? base.severity;
    const ctx: TelemetryContext = { ...baseCtx, ...options.ctx };

    // 1. Sentry / console — only when the log policy asks for it.
    if (log !== "none") guardSink(() => deps.reporter.report(error, log, ctx));
    // 2. alerting gate (no-op below threshold).
    guardSink(() => deps.notifier.notify(error, severity, ctx));
    // 3. PRESENTER only for Presenter-actionable surfaces. "redirect"/"page" are
    //    escalated by the client useErrorHandler, not the Presenter; "inline"/"silent"
    //    do nothing here. Only "toast"/"alert" reach present().
    if (present === "toast" || present === "alert")
      guardSink(() => deps.presenter.present(error, present, ctx));
    // 4. T1 IMPACT BREADCRUMB: record the user-visible impact WITHOUT a re-capture,
    //    keyed by ctx.correlationId, INDEPENDENT of log. Skipped only when truly silent.
    if (present !== "silent") guardSink(() => deps.reporter.breadcrumb(error, present, ctx));

    // The point: caller drives context-specific UI (incl. "page" escalation) off result.policy.
    return { error, code: error.code, policy: { ...base, severity, present, log } };
  };
