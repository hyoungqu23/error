// error/types.ts — the deps bag carries the registry alongside the sinks.
// r3: registry narrows to Record<ErrorCode, ErrorMeta>; adds the Notifier sink
// (defaulted to noopNotifier at each composition root), so handleError can alert.
//
// The Translator is intentionally NOT here (§4.4): message resolution is a
// render-time concern, not part of the handleError pipeline.
import type { ErrorRegistry } from "./registry";
import type { Reporter, Presenter } from "./telemetry";
import type { Notifier } from "./notifier";

export interface HandleErrorDeps {
  registry: ErrorRegistry; // = Record<ErrorCode, ErrorMeta> (§3.1)
  reporter: Reporter; // §5 — monitoring (Sentry / console)
  presenter: Presenter; // §5 — UX (toast / no-op on server)
  notifier: Notifier; // §5 — alerting (pager); default noopNotifier
}
