// error/types.ts — the deps bag for the decision-model handleError.
//
// P3b-ii: handleError is now a thin delegate over a DecisionSystem + the decision sinks
// (ReporterSink/NotifierSink from decision/types). The old registry + Reporter/Presenter/
// Notifier deps are gone (the old sink interface FILES survive for error-adapters until P3e/P6).
//
// The Translator is intentionally NOT here (§4.4): message resolution is a
// render-time concern, not part of the handleError pipeline.
import type { HandleErrorSystem } from "./handle-error";
import type { ReporterSink, NotifierSink } from "./decision/types";

export interface HandleErrorDeps {
  system: HandleErrorSystem; // resolves policy + executes telemetry (the decision engine)
  reporter: ReporterSink; // §5 — monitoring (Sentry / console)
  notifier: NotifierSink; // §5 — alerting (pager); default noop
}
