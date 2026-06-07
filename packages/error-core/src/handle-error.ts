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
    // 파이프라인 캡처 소유 마킹은 "원격 관측 시스템에 실제로 전송된 경우"에만 건다(P0b 리뷰 P1
    // + throttle-drop/guarded-swallow 봉인 + Codex P1). 마킹을 capture 의도(불리언)에 걸거나 단순히
    // 호출 완료에 걸면, 파이프라인본이 Sentry에 가지 않았는데도(아래 경로들) 자동 캡처본까지 드롭되어
    // 이벤트 0건(가시성 완전 상실)이 된다. captured=false로 남아 자동 캡처가 안전망이 되는 경로:
    //   - sample-out (executeTelemetryDecision이 capture를 아예 호출하지 않음)
    //   - sink-throw (capture가 throw → 아래 captured 할당에 도달하지 않음)
    //   - throttle-drop / guarded-swallow (capture가 false를 반환 — 반환 프로토콜, types.ts 참조)
    //   - 전송 주장 없음 (legacy void sink가 undefined 반환 — 명시적 true가 아니므로 비마킹)
    let captured = false;
    const trackingSinks: HandleErrorSinks = {
      reporter: {
        capture(error, decision, captureCtx) {
          // 마킹은 오직 명시적 `true`(마커 소비 원격 transport=Sentry 전송 확인)일 때만 건다.
          // false(throttle-drop / 전송 실패 / guarded-swallow / console·noop)는 비전송이고,
          // undefined(legacy void sink)는 "전송 주장 없음"이라 비마킹한다(Codex P1: undefined를
          // 전송으로 간주하면 composite에 void sink 하나만 있어도 Sentry throttle-drop을 깔아뭉개
          // 마킹→자동 캡처본 드롭→스톰 시 0건 부활). 최악은 자동 캡처 중복 1건이지 0건이 아니다.
          // capture가 throw하면 이 줄에 도달하지 않아 captured는 false로 남는다.
          const result = sinks.reporter.capture(error, decision, captureCtx);
          captured = result === true;
          return result;
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
