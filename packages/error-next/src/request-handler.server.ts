// error/request-handler.server.ts   ('server-only')
// The SERVER composition root + per-request handler retrieval, collapsed into one
// server-only module.
//
//   - serverDeps               : the request-INDEPENDENT sink choice (built once per
//                                module load — NO correlationId/user; those live on the
//                                per-request ctx). A console ReporterSink + a pager NotifierSink.
//   - errorResponder           : the bound HTTP error responder for route handlers.
//   - getRequestCorrelationId  : request-scoped correlation ID (React cache()).
//   - getRequestHandler        : per-request `handleServerError`, request-scoped via React
//                                cache(). Policy is owned by the injected DecisionSystem
//                                (errorSystem) — there is NO active-registry binding (P3e/P5).
//                                Module-level mutable ctx/handler is FORBIDDEN — it would leak
//                                across concurrent requests.
import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import {
  createHandleError,
  createErrorResponder,
  type HandleErrorOptions,
  type HandleErrorDeps,
  type DecisionFailure,
  type TelemetryContext,
  type OccurrenceContext,
  type ReporterSink,
  type NotifierSink,
} from "error-core";
import { errorSystem } from "./error-system";
import { createPagerNotifier, webhookPagerTransport } from "error-adapters/pager-notifier";

/**
 * Build the server alerting sink. Paging belongs to the server runtime. The decision engine
 * decides WHETHER to alert (decision.telemetry.alert, resolved from catalog + occurrence);
 * this sink just delivers. When no webhook is configured (tests / local / preview), a no-op
 * sink so handleError never pages.
 */
const buildServerNotifier = (): NotifierSink => {
  const url = process.env.PAGER_WEBHOOK_URL;
  return url ? createPagerNotifier(webhookPagerTransport(url)) : { alert() {} };
};

/**
 * Server reporter (monitoring sink): a structured stderr line keyed by code/level/correlationId.
 * NOTE: the guarded-composite dead-man's-switch + health() (RFC §8.4) is deferred to P6/P7 on top
 * of ReporterSink; until then the /health probe (apps, P8) has no health() to read.
 */
export const serverReporter: ReporterSink = {
  capture(error, decision, ctx) {
    console.error({
      tag: "[error]",
      code: error.code,
      level: decision.level,
      correlationId: ctx.correlationId,
      route: ctx.route,
    });
  },
  breadcrumb() {},
};

/**
 * Request-independent server deps. Safe to build at module scope precisely BECAUSE it carries no
 * per-request state — user/correlation ride on the per-request ctx, not the sinks. This is the
 * ONLY place the server picks its sinks; the injected DecisionSystem (errorSystem) owns policy.
 */
export const serverDeps: HandleErrorDeps = {
  system: errorSystem,
  reporter: serverReporter,
  notifier: buildServerNotifier(),
};

/**
 * The bound HTTP error responder for route handlers: the single outbound leak gate. Maps any
 * caught value to a messageless, details-gated Response (status = catalog defaultHttpStatus).
 */
export const errorResponder = createErrorResponder(errorSystem);

/** The shape consumers destructure: `const handleServerError = await getRequestHandler()`. */
export type HandleServerError = (input: unknown, options?: HandleErrorOptions) => DecisionFailure;

/** The catch-all occurrence used when a boundary did not supply its own. */
const BASE_OCCURRENCE: OccurrenceContext = {
  operation: "unknown",
  interaction: "event-handler",
  uiScope: "page",
  criticality: "normal",
};

/**
 * Session → TelemetryContext.user. MUST NOT throw or redirect: the error handler must be
 * buildable even for anonymous/failed requests. cache()d so the lookup is shared per request.
 * This standalone build has no auth provider wired, so it resolves to anonymous; swap in the
 * host session lookup at the real composition root.
 */
const getSessionUser = cache(
  async (): Promise<NonNullable<TelemetryContext["user"]> | null> => {
    try {
      return null; // anonymous ctx is correct when no session provider is wired
    } catch {
      // Auth failures must not block error handling. Anonymous ctx is correct.
      return null;
    }
  },
);

/**
 * Request-scoped correlation ID. Honors an inbound, well-formed `x-request-id` (minted by
 * proxy.ts — §9), else mints a last-resort fallback. cache() guarantees every caller within
 * THIS request sees the same ID.
 */
export const getRequestCorrelationId = cache(async (): Promise<string> => {
  const h = await headers();
  const incoming = h.get("x-request-id");
  return incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
});

/**
 * Lazily build + per-request-memoize a `handleServerError`. MUST be async (awaits headers() +
 * session). React cache() memoizes PER REQUEST in the App Router — two concurrent requests never
 * observe each other's memoized value. Policy is owned by errorSystem; there is no per-request
 * registry binding (P3e/P5).
 */
export const getRequestHandler = cache(async (): Promise<HandleServerError> => {
  const [correlationId, user] = await Promise.all([
    getRequestCorrelationId(),
    getSessionUser(), // null when unauthenticated — never throws/redirects
  ]);
  const ctx: TelemetryContext = { runtime: "server", operation: "unknown", correlationId, user };
  return createHandleError(
    serverDeps.system,
    { reporter: serverDeps.reporter, notifier: serverDeps.notifier },
    ctx,
    BASE_OCCURRENCE,
  );
});
