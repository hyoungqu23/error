// error/adapters/composite.ts  — GUARDED with a DEAD-MAN'S-SWITCH (design §5.3)
// Telemetry must never throw into the app, BUT a silently-swallowed telemetry failure
// is invisible — so we count failures per sink and emit a RATE-LIMITED last-resort line
// to stderr (server) / console.error (client).
import type { Reporter } from "../telemetry";

export interface ReporterHealth {
  readonly failures: ReadonlyMap<string, number>;
  /** Running total of swallowed failures across all sinks/ops (never reset). */
  readonly totalFailures: number;
  readonly lastFailureAt?: number;
}

const emitLastResort = (line: Record<string, unknown>): void => {
  const text = `[telemetry-dead-mans-switch] ${JSON.stringify(line)}\n`;
  const proc = (globalThis as { process?: { stderr?: { write(s: string): void } } }).process;
  if (proc?.stderr?.write) proc.stderr.write(text);
  else console.error(text);
};

export interface CompositeReporterOptions {
  /** Min ms between last-resort emissions (don't let the dead-man's-switch itself storm). default 5000 */
  alertThrottleMs?: number;
  now?: () => number;
}

/** A Reporter paired with a stable label used in failure accounting. */
export interface LabeledReporter {
  label: string;
  reporter: Reporter;
}

export interface GuardedCompositeReporter extends Reporter {
  /** Inspectable health — surface in a /health route or assert in tests. */
  health(): ReporterHealth;
}

export const guardedCompositeReporter = (
  sinks: ReadonlyArray<LabeledReporter>,
  options: CompositeReporterOptions = {},
): GuardedCompositeReporter => {
  const throttleMs = options.alertThrottleMs ?? 5000;
  const now = options.now ?? (() => Date.now());
  const failures = new Map<string, number>();
  let totalFailures = 0; // running total across all sinks/ops; never reset.
  let lastFailureAt: number | undefined;
  let lastAlertAt = 0;

  const guard = (label: string, op: string, fn: () => void): void => {
    try {
      fn();
    } catch (cause) {
      const n = (failures.get(label) ?? 0) + 1;
      failures.set(label, n);
      totalFailures += 1;
      lastFailureAt = now();
      if (lastFailureAt - lastAlertAt >= throttleMs) {
        lastAlertAt = lastFailureAt;
        emitLastResort({
          sink: label,
          op,
          totalFailures: n,
          runningTotal: totalFailures,
          message: cause instanceof Error ? cause.message : String(cause),
          at: new Date(lastFailureAt).toISOString(),
        });
      }
    }
  };

  return {
    report: (e, l, c) => sinks.forEach((s) => guard(s.label, "report", () => s.reporter.report(e, l, c))),
    breadcrumb: (e, surface, c) =>
      sinks.forEach((s) => guard(s.label, "breadcrumb", () => s.reporter.breadcrumb(e, surface, c))),
    setUser: (u) => sinks.forEach((s) => guard(s.label, "setUser", () => s.reporter.setUser(u))),
    setContext: (c) => sinks.forEach((s) => guard(s.label, "setContext", () => s.reporter.setContext(c))),
    health: () => ({ failures: new Map(failures), totalFailures, lastFailureAt }),
  };
};

/** "Optional" = compose this in when monitoring is disabled (e.g. in tests / local). */
export const noopReporter: Reporter = {
  report() {},
  breadcrumb() {},
  setUser() {},
  setContext() {},
};

/**
 * Legacy variadic composite (unlabeled). Kept for call sites that don't need health
 * accounting; prefer guardedCompositeReporter([{label,reporter}, …]) for production.
 */
const guard = (fn: () => void): void => {
  try {
    fn();
  } catch {
    /* telemetry must never throw */
  }
};

export const compositeReporter = (...r: Reporter[]): Reporter => ({
  report: (e, l, c) => r.forEach((x) => guard(() => x.report(e, l, c))),
  breadcrumb: (e, surface, c) => r.forEach((x) => guard(() => x.breadcrumb(e, surface, c))),
  setUser: (u) => r.forEach((x) => guard(() => x.setUser(u))),
  setContext: (c) => r.forEach((x) => guard(() => x.setContext(c))),
});
