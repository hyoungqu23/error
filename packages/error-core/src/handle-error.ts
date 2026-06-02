// error/handle-error.ts — decision-system delegate. Policy is resolved by the system
// (resolveErrorDecision via finalizeUnknown); telemetry is executed by executeErrorDecision.
// No Presenter: presentation is the consumer/UI's job (decision-model principle).
import type { DecisionSystem, DecisionFailure } from "./decision/system";
import type {
  ReporterSink,
  NotifierSink,
  TelemetryContext,
  TelemetryDecision,
  OccurrenceContext,
  RuntimeContext,
} from "./decision/types";

/**
 * The slice of a DecisionSystem the delegate consumes — only finalizeUnknown + executeErrorDecision.
 * Pinned to the base (loose) catalog generics so any concretely-typed `createDecisionSystem(...)`
 * is assignable (DecisionSystem<SpecificCatalog> is not assignable to DecisionSystem<ErrorCatalog>
 * because the catalog-typed `fail`/`appError` methods are contravariant — but those aren't used here).
 */
export type HandleErrorSystem = Pick<DecisionSystem, "finalizeUnknown" | "executeErrorDecision">;

export interface HandleErrorOptions {
  occurrence?: Partial<OccurrenceContext>;
  /** 5% escape hatch — overrides the resolved telemetry (replaces the old present/log/severity). */
  telemetry?: Partial<TelemetryDecision>;
  fallbackMessage?: string;
  ctx?: Partial<TelemetryContext>;
}

export interface HandleErrorSinks {
  reporter: ReporterSink;
  notifier: NotifierSink;
}

const guardSink = (fn: () => void): void => {
  try {
    fn();
  } catch {
    // Error handling must never become the error source. Production visibility
    // still belongs in guardedCompositeReporter / pager transports.
  }
};

/**
 * Handle a caught value with the given decision-system + sinks. finalizeUnknown builds the
 * decision + payload; executeErrorDecision runs telemetry (capture → breadcrumb → alert).
 * Returns the DecisionFailure so the caller drives context-specific UI off `result.decision`.
 */
export const createHandleError =
  (
    system: HandleErrorSystem,
    sinks: HandleErrorSinks,
    baseCtx: TelemetryContext,
    baseOccurrence: OccurrenceContext,
  ) =>
  (input: unknown, options: HandleErrorOptions = {}): DecisionFailure => {
    const occurrence: OccurrenceContext = { ...baseOccurrence, ...options.occurrence };
    const runtime: Partial<RuntimeContext> = {
      runtime: baseCtx.runtime,
      ...(baseCtx.correlationId !== undefined ? { correlationId: baseCtx.correlationId } : {}),
      ...(baseCtx.route !== undefined ? { route: baseCtx.route } : {}),
      ...(baseCtx.user !== undefined ? { user: baseCtx.user } : {}),
    };
    let failure = system.finalizeUnknown(input, occurrence, runtime);
    if (options.telemetry) {
      failure = {
        ...failure,
        decision: {
          ...failure.decision,
          telemetry: { ...failure.decision.telemetry, ...options.telemetry },
        },
      };
    }
    const ctx: TelemetryContext = { ...baseCtx, ...options.ctx };
    guardSink(() => system.executeErrorDecision(failure.error, failure.decision, ctx, sinks));
    return failure;
  };
