// error/notifier.ts
// The third sink (design §5.1), injected exactly like Reporter/Presenter, plus the
// AlertPolicy it is gated by. Reporter answers "record it for debugging"; Notifier
// answers "wake a human NOW". AlertPolicy is "is this loud enough to page?" — pure,
// data-driven, testable.
//
// NOTE (module-map adaptation): the design split AlertPolicy into a separate
// `alert-policy.ts`. The canonical module map co-locates AlertPolicy with the Notifier
// here, so the policy interface + the threshold/gate helpers are merged into this file.
import type { Severity } from "./severity";
import type { DomainError } from "./app-error";
import type { TelemetryContext } from "./telemetry";

// ── AlertPolicy ─────────────────────────────────────────────────────────────
// Severity ordering mirrors error/severity.ts: fatal > error > warning > info.
const SEVERITY_RANK: Record<Severity, number> = { info: 0, warning: 1, error: 2, fatal: 3 };

export const compareSeverity = (a: Severity, b: Severity): number =>
  SEVERITY_RANK[a] - SEVERITY_RANK[b];

export interface AlertPolicy {
  /** Decide whether an error at this severity, in this context, should page on-call. */
  shouldPage(error: DomainError, severity: Severity, ctx: TelemetryContext): boolean;
}

export interface ThresholdPolicyOptions {
  /** Minimum severity that pages. Default "fatal" — only true incidents wake someone. */
  readonly threshold?: Severity;
  /** Optional hard suppression (e.g. never page on client-runtime errors). */
  readonly suppressRuntimes?: ReadonlyArray<TelemetryContext["runtime"]>;
}

/**
 * Default policy: page iff severity >= threshold AND runtime not suppressed.
 * Severity is passed in (already resolved by handleError from registry/override),
 * so the policy never re-reads the registry — single source of truth upstream.
 */
export const thresholdAlertPolicy = (opts: ThresholdPolicyOptions = {}): AlertPolicy => {
  const threshold: Severity = opts.threshold ?? "fatal";
  const suppressed = new Set<TelemetryContext["runtime"]>(opts.suppressRuntimes ?? []);
  return {
    shouldPage(_error, severity, ctx) {
      if (suppressed.has(ctx.runtime)) return false;
      return compareSeverity(severity, threshold) >= 0;
    },
  };
};

// ── Notifier ────────────────────────────────────────────────────────────────
export interface Notifier {
  /** Fire-and-forget alert. MUST NOT throw and MUST NOT block handleError. */
  notify(error: DomainError, severity: Severity, ctx: TelemetryContext): void;
}

/** Optional sink: compose this in when paging is disabled (tests / local / preview). */
export const noopNotifier: Notifier = { notify() {} };

const guardN = (fn: () => void): void => {
  try {
    fn();
  } catch {
    /* alerting must never throw into the app — same invariant as compositeReporter */
  }
};

/** Fan out to N notifiers; swallow per-adapter failures. Is itself a Notifier. */
export const compositeNotifier = (...n: Notifier[]): Notifier => ({
  notify: (e, s, c) => n.forEach((x) => guardN(() => x.notify(e, s, c))),
});

/**
 * Wraps a delivery Notifier with an AlertPolicy gate. handleError always calls
 * notifier.notify(); the gate decides whether the page actually goes out, so the
 * threshold logic is injected (swappable per environment) rather than hard-coded.
 */
export const policyGatedNotifier = (policy: AlertPolicy, delivery: Notifier): Notifier => ({
  notify: (error, severity, ctx) => {
    if (policy.shouldPage(error, severity, ctx)) delivery.notify(error, severity, ctx);
  },
});
