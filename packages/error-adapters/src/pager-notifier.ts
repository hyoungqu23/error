// error/adapters/pager-notifier.ts  (design §5.1)
// The ONLY file that knows a pager vendor exists. Swappable: PagerDuty / Opsgenie
// / Slack are three PagerTransport implementations behind one webhook shape.
import "server-only"; // paging belongs to the server runtime; never bundled to the client
import type { Notifier } from "error-core/notifier";
import type { DomainError } from "error-core/app-error";
import type { Severity } from "error-core/severity";
import type { TelemetryContext } from "error-core/telemetry";

export interface PageEvent {
  readonly title: string;
  readonly severity: Severity;
  readonly code: string;
  readonly correlationId?: string;
  readonly route?: string;
  readonly runtime: TelemetryContext["runtime"];
  readonly dedupKey: string; // collapses a storm of the same code into one incident
}

/** Swap this to point at PagerDuty Events API v2, Opsgenie, or a Slack webhook. */
export interface PagerTransport {
  send(event: PageEvent): Promise<void>;
}

const toPageEvent = (
  error: DomainError,
  severity: Severity,
  ctx: TelemetryContext,
): PageEvent => ({
  title: `[${severity.toUpperCase()}] ${error.code}: ${error.message}`,
  severity,
  code: error.code,
  correlationId: ctx.correlationId,
  route: ctx.route,
  runtime: ctx.runtime,
  // Dedup on code+route so retries/refresh-loops don't spam on-call.
  dedupKey: `${error.code}:${ctx.route ?? "unknown"}`,
});

/**
 * Per-dedupKey suppressor (G7): one page per dedupKey per window. A refill-by-time
 * token bucket per key — the FIRST page for a key passes (capacity 1), subsequent
 * pages for the same key are suppressed until the window elapses, so a Slack webhook
 * is not flooded by a refresh/retry storm of the same incident.
 */
interface DedupSuppressor {
  /** true = allow this page; false = suppress (already paged within the window). */
  allow(dedupKey: string): boolean;
}
const makeDedupSuppressor = (
  windowMs: number,
  now: () => number = () => Date.now(),
): DedupSuppressor => {
  const lastPagedAt = new Map<string, number>();
  return {
    allow(dedupKey) {
      const t = now();
      const prev = lastPagedAt.get(dedupKey);
      if (prev !== undefined && t - prev < windowMs) return false;
      lastPagedAt.set(dedupKey, t);
      return true;
    },
  };
};

export interface PagerNotifierOptions {
  /** Min ms between pages for the SAME dedupKey. Default 60_000 (one page/min/incident). */
  dedupWindowMs?: number;
  now?: () => number;
}

/**
 * Default pager Notifier. notify() is sync-returning (fire-and-forget): it kicks off
 * the async send and never awaits it, so handleError stays non-blocking. Transport
 * failures are swallowed (and self-reported to console) — alerting must never throw.
 * (G7) An in-process per-dedupKey suppressor collapses a storm of the same incident
 * into one page per window so the Slack webhook is not flooded.
 */
export const createPagerNotifier = (
  transport: PagerTransport,
  options: PagerNotifierOptions = {},
): Notifier => {
  const suppressor = makeDedupSuppressor(options.dedupWindowMs ?? 60_000, options.now);
  return {
    notify(error, severity, ctx) {
      const event = toPageEvent(error, severity, ctx);
      if (!suppressor.allow(event.dedupKey)) return; // already paged this incident this window.
      void transport.send(event).catch((cause: unknown) => {
        console.error({ tag: "[pager-failed]", code: error.code, cause });
      });
    },
  };
};

/** Reference transport: a generic incoming-webhook adapter (Slack-shaped). */
export const webhookPagerTransport = (webhookUrl: string): PagerTransport => ({
  async send(event) {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Bound the outbound call so a hung webhook can't leak a dangling request.
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({
        text: event.title,
        // PagerDuty Events API v2 swap-in: { routing_key, dedup_key: event.dedupKey,
        //   event_action: "trigger", payload: { summary: event.title, severity: event.severity,
        //   source: event.route ?? "app", custom_details: { code, correlationId, runtime } } }
        dedup_key: event.dedupKey,
        severity: event.severity,
        custom_details: {
          code: event.code,
          correlationId: event.correlationId,
          route: event.route,
          runtime: event.runtime,
        },
      }),
    });
  },
});
