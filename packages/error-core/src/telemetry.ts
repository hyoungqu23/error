// error/telemetry.ts
// Telemetry interfaces (design §5). Two sinks: Reporter (monitoring) + Presenter (UX).
// The third sink (Notifier / alerting) lives in ./notifier alongside its AlertPolicy.
import type { DomainError } from "./app-error";
import type { LogLevel, PresentAction } from "./policy";

/** Stable context that rides along with every signal. */
export interface TelemetryContext {
  correlationId?: string;
  user?: { id: string; role?: string } | null;
  route?: string;
  runtime: "server" | "client"; // r3: there is no "edge" runtime on Next 16
  /** Seam for future OTel trace correlation. Unused in r5; carried through unchanged. */
  traceId?: string;
}

/** Monitoring sink (Sentry-class; a composite may also fan out to console). */
export interface Reporter {
  report(error: DomainError, level: LogLevel, ctx: TelemetryContext): void;
  /**
   * Record the user-visible IMPACT of an error (T1 impact breadcrumb) WITHOUT a
   * re-capture: keyed by ctx.correlationId, independent of the log level. `surface`
   * is the resolved PresentAction the user actually experienced (inline/toast/…).
   */
  breadcrumb(error: DomainError, surface: PresentAction, ctx: TelemetryContext): void;
  setUser(user: TelemetryContext["user"]): void;
  setContext(ctx: Partial<TelemetryContext>): void;
}

/** User-facing UX sink (sonner / no-op on server). */
export interface Presenter {
  present(error: DomainError, action: PresentAction, ctx: TelemetryContext): void;
}
