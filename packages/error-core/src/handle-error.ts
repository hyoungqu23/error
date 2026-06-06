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
import { markPipelineCaptured } from "./pipeline-captured";

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
    // 파이프라인 캡처 소유 마킹은 "capture가 실제로 실행된 경우"에만 건다(P0b 리뷰 P1):
    // capture 의도(불리언)에 걸면 sample-out·sink-throw 시 파이프라인본이 Sentry에 가지
    // 않았는데도 자동 캡처본까지 드롭되어 이벤트 0건(가시성 완전 상실)이 된다. tracking
    // reporter는 capture 호출이 throw 없이 완료된 뒤에만 captured를 세운다 — sink 실패와
    // 샘플아웃이 한 메커니즘으로 처리된다(둘 다 captured=false → 자동 캡처가 안전망으로 남는다).
    let captured = false;
    const trackingSinks: HandleErrorSinks = {
      reporter: {
        capture(error, decision, captureCtx) {
          sinks.reporter.capture(error, decision, captureCtx);
          captured = true; // capture가 throw하면 도달하지 않는다 — 마킹도 일어나지 않는다.
        },
        breadcrumb(error, decision, breadcrumbCtx) {
          sinks.reporter.breadcrumb(error, decision, breadcrumbCtx);
        },
      },
      notifier: sinks.notifier,
    };
    guardSink(() => system.executeErrorDecision(failure.error, failure.decision, ctx, trackingSinks));
    // 마킹은 원본 input에 건다(capture되는 wrapped AppError가 아니라): Track-2가 rethrow하는
    // 것은 원본이고 Sentry 자동 캡처가 잡는 것도 원본이므로, 합성 beforeSend가 매칭하려면
    // 마커가 원본에 있어야 한다. input이 AppError면 input === failure.error라 파이프라인본의
    // originalException도 마킹된다 — 그 경우 composeBeforeSend의 errsys.source 태그 가드가
    // 파이프라인본을 살린다.
    if (captured) markPipelineCaptured(input);
    return failure;
  };
