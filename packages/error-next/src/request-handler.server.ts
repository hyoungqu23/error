// error/request-handler.server.ts   ('server-only')
// The SERVER composition root + per-request handler retrieval, collapsed into one
// server-only module (the design split this across server-deps / session /
// get-request-handler; the canonical module map exposes all three surfaces here).
//
//   - serverDeps               : the request-INDEPENDENT sink choice (built once per
//                                module load — NO correlationId/user; those live on the
//                                per-request ctx). Composes Sentry + console reporter,
//                                a no-op presenter, and the pager notifier.
//   - getRequestCorrelationId  : request-scoped correlation ID (React cache()).
//   - getRequestHandler        : per-request `handleServerError`, request-scoped via
//                                React cache(), bound to serverDeps.registry through
//                                runWithErrorRegistry so the getters resolve the
//                                request's registry. Module-level mutable ctx/handler is
//                                FORBIDDEN — it would leak across concurrent requests.
import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { createHandleError, type HandleErrorOptions } from "error-core/handle-error";
import { runWithErrorRegistry } from "error-core/active-registry";
import type { ResolvedAppError } from "error-core/app-error";
import type { HandleErrorDeps } from "error-core/types";
import type { Presenter } from "error-core/telemetry";
import type { TelemetryContext } from "error-core/telemetry";
import type { Notifier } from "error-core/notifier";
import { DEFAULT_ERROR_REGISTRY } from "error-core/registry";
import { guardedCompositeReporter, type GuardedCompositeReporter } from "error-core/adapters/composite";
import { createSentryReporter } from "error-adapters/sentry-reporter";
import { createConsoleReporter } from "error-core/adapters/console-reporter";
import { createPagerNotifier, webhookPagerTransport } from "error-adapters/pager-notifier";
import { noopNotifier } from "error-core/notifier";

/** Server presenter is a no-op: there is no DOM. All server handleError calls pass present:"silent". */
const serverPresenter: Presenter = { present() {} };

/**
 * Build the server alerting sink. Paging belongs to the server runtime and is gated by
 * an AlertPolicy threshold owned by the pager adapter. When no webhook is configured
 * (tests / local / preview), fall back to the no-op notifier so handleError never alerts.
 */
const buildServerNotifier = (): Notifier => {
  const url = process.env.PAGER_WEBHOOK_URL;
  return url ? createPagerNotifier(webhookPagerTransport(url)) : noopNotifier;
};

/**
 * The guarded composite reporter, kept as its own typed handle so the health route
 * (src/app/api/health/route.ts) can read health() without widening HandleErrorDeps.
 * guardedCompositeReporter counts per-sink swallowed failures (the dead-man's-switch);
 * health().failures crossing a threshold is what the /health GET turns into a 503.
 */
export const serverReporter: GuardedCompositeReporter = guardedCompositeReporter([
  { label: "sentry", reporter: createSentryReporter() },
  { label: "console", reporter: createConsoleReporter() },
]);

/**
 * Request-independent server deps. Safe to build at module scope precisely BECAUSE it
 * carries no per-request state — user/correlation ride on the per-request ctx, not the
 * reporter. This is the ONLY place the server picks its sinks.
 *
 * G10 DEAD-MAN'S-SWITCH WIRING: serverReporter (the guarded composite) self-emits a
 * rate-limited last-resort line to stderr when a sink swallows a failure, and exposes
 * health() for the /health probe. The escalation contract is: when health().failures
 * cross the route's threshold, /health returns 503 AND the operator's uptime monitor
 * pages on the 503. To page IN-PROCESS instead (no external monitor), a host can pass
 * a CompositeReporterOptions hook that calls serverDeps.notifier.notify(...) on the
 * threshold crossing — kept OUT of this standalone build because notify() needs a
 * DomainError + severity + TelemetryContext, none of which exist at the swallow site;
 * the /health 503 + external monitor is the wired default. (See route.ts.)
 */
export const serverDeps: HandleErrorDeps = {
  registry: DEFAULT_ERROR_REGISTRY,
  reporter: serverReporter,
  presenter: serverPresenter,
  notifier: buildServerNotifier(),
};

/** The shape consumers destructure: `const handleServerError = await getRequestHandler()`. */
export type HandleServerError = (
  input: unknown,
  options?: HandleErrorOptions,
) => ResolvedAppError;

/**
 * Session → TelemetryContext.user. MUST NOT throw or redirect (unlike a route-guard
 * verifySession): the error handler must be buildable even for anonymous/failed
 * requests. cache()d so the lookup is shared per request. This standalone build has no
 * auth provider wired, so it resolves to anonymous; swap in the host session lookup
 * (e.g. getServerSupabase().auth.getUser()) at the real composition root.
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
 * Request-scoped correlation ID. Honors an inbound, well-formed `x-request-id`
 * (minted by proxy.ts — §9), else mints a last-resort fallback. cache() guarantees
 * every caller within THIS request sees the same ID.
 */
export const getRequestCorrelationId = cache(async (): Promise<string> => {
  const h = await headers();
  const incoming = h.get("x-request-id");
  return incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
});

/**
 * Lazily build + per-request-memoize a `handleServerError`. MUST be async (awaits
 * headers() + session). The active registry is bound to this request via
 * runWithErrorRegistry so the getters resolve against serverDeps.registry for THIS
 * request only. React cache() memoizes PER REQUEST in the App Router — two concurrent
 * requests never observe each other's memoized value.
 */
export const getRequestHandler = cache(async (): Promise<HandleServerError> => {
  const [correlationId, user] = await Promise.all([
    getRequestCorrelationId(),
    getSessionUser(), // null when unauthenticated — never throws/redirects
  ]);
  const ctx: TelemetryContext = { runtime: "server", correlationId, user };
  const handle = createHandleError(serverDeps, ctx);
  // Wrap so any getter read inside the returned handler resolves the request's registry.
  return (input, options) =>
    runWithErrorRegistry(serverDeps.registry, () => handle(input, options));
});
