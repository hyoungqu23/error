// error/adapters/sentry-reporter.ts  — HARDENED (design §5.3)
// The only file that imports the vendor SDK on the monitoring path.
// (1) beforeSend PII scrub + details redaction by the same allowlist;
// (2) fingerprint:[error.code] for stable grouping;
// (3) a token-bucket throttle for the window.onerror/onunhandledrejection storm;
// (4) it never swallows a send failure itself — it lets it propagate so the composite
//     dead-man's-switch can account for it.
import * as Sentry from "@sentry/nextjs";
import {
  CANONICAL_ERROR_SEMANTICS,
  isKnownErrorCode,
  type ReporterSink,
  type TelemetryContext,
  type TelemetryDecision,
  type AppError,
  type ErrorSemantics,
} from "error-core";

// P3c: the per-code client-details allowlist moved from the deleted `serialize-client`
// (gateClientDetails/DETAILS_ALLOWLIST) to the decision-system SSOT `CANONICAL_ERROR_SEMANTICS`
// (detailsExposure + detailsAllowlist). This local gate redacts the Sentry `details` context by
// the SAME allowlist that gates the client payload — shallow-pick allowlisted keys, else undefined.
const gateClientDetails = (code: string, details: unknown): unknown => {
  if (!isKnownErrorCode(code)) return undefined;
  const semantics: ErrorSemantics = CANONICAL_ERROR_SEMANTICS[code];
  const allowlist = semantics.detailsExposure === "allowlist" ? semantics.detailsAllowlist : undefined;
  if (!allowlist?.length || typeof details !== "object" || details === null) return undefined;
  const source = details as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const key of allowlist) {
    if (Object.prototype.hasOwnProperty.call(source, key)) picked[key] = source[key];
  }
  return Object.keys(picked).length > 0 ? picked : undefined;
};

// @sentry/nextjs v8 SeverityLevel is "fatal"|"error"|"warning"|"log"|"info"|"debug".
// We only emit the four we use; the type is the real Sentry union so scope.setLevel matches.
const toSentryLevel = (level: TelemetryDecision["level"]): Sentry.SeverityLevel =>
  level === "fatal"
    ? "fatal"
    : level === "warning"
      ? "warning"
      : level === "info"
        ? "info"
        : "error";

/** Keys whose VALUES are scrubbed wherever they appear in extra/contexts. */
const PII_KEYS = new Set([
  "email",
  "token",
  "access_token",
  "refresh_token",
  "authorization",
  "password",
  "cookie",
  "set-cookie",
  "api_key",
  "apikey",
  "secret",
]);
const TOKEN_RE = /\b(?:eyJ[\w-]{10,}|[A-Za-z0-9_-]{40,}|Bearer\s+[\w.-]+)\b/g;

const scrubString = (s: string): string => s.replace(TOKEN_RE, "[redacted-token]");

/** Recursively redact PII keys + token-shaped strings. Bounded depth so a cyclic/huge object can't hang beforeSend. */
const scrubDeep = (value: unknown, depth = 0): unknown => {
  if (depth > 6) return "[redacted-depth]";
  if (typeof value === "string") return scrubString(value);
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = PII_KEYS.has(k.toLowerCase()) ? "[redacted]" : scrubDeep(v, depth + 1);
    }
    return out;
  }
  return value;
};

/** Simple monotonic-time token bucket. capacity tokens, refilled at `ratePerSec`. */
interface TokenBucket {
  allow(): boolean;
  /** Drops in the current contiguous throttled run (resets to 0 on the next allow). */
  droppedSinceLastAllow(): number;
  /** RUNNING total of all drops ever (G4/G5) — never reset; for the throttled{n} aggregate. */
  droppedTotal(): number;
}
const makeTokenBucket = (
  capacity: number,
  ratePerSec: number,
  now: () => number = () => Date.now(),
): TokenBucket => {
  let tokens = capacity;
  let last = now();
  let dropped = 0;
  let droppedTotalCount = 0;
  return {
    allow() {
      const t = now();
      tokens = Math.min(capacity, tokens + ((t - last) / 1000) * ratePerSec);
      last = t;
      if (tokens >= 1) {
        tokens -= 1;
        dropped = 0; // reset the CONTIGUOUS-run counter, not the running total.
        return true;
      }
      dropped += 1;
      droppedTotalCount += 1; // running total persists across allows.
      return false;
    },
    droppedSinceLastAllow() {
      return dropped;
    },
    droppedTotal() {
      return droppedTotalCount;
    },
  };
};

export interface SentryReporterConfig {
  /** Storm guard: max browser-boundary events accepted per window before throttling. */
  browserBurstCapacity?: number; // default 5
  browserRefillPerSec?: number; // default 1
}

/** ReporterSink + the running throttle-drop total, so a `throttled{n}` aggregate can read it. */
export interface SentryReporter extends ReporterSink {
  /** RUNNING total of browser-boundary events dropped by the storm throttle (G4/G5). */
  droppedTotal(): number;
  /** Sentry-global user/context wiring (composition-root convenience — not part of ReporterSink). */
  setUser(user: { id: string; role?: string } | null): void;
  setContext(ctx: { correlationId?: string }): void;
}

export const createSentryReporter = (config: SentryReporterConfig = {}): SentryReporter => {
  const browserBucket = makeTokenBucket(
    config.browserBurstCapacity ?? 5,
    config.browserRefillPerSec ?? 1,
  );

  return {
    capture(error: AppError, decision: TelemetryDecision, ctx: TelemetryContext) {
      // (3) Storm vector: only window-boundary events (route tag set by §8.3) are bucketed.
      const fromBrowserBoundary =
        ctx.route === "window.onerror" || ctx.route === "window.onunhandledrejection";
      if (fromBrowserBoundary && !browserBucket.allow()) {
        return; // dropped by throttle; not an error — do NOT feed the dead-man's-switch.
      }

      // @sentry/nextjs v8: the 2nd arg is a CaptureContext; the callback form
      // ((scope: Scope) => Scope) lets us set level/fingerprint/tags/contexts/user
      // per event. tags/contexts/user/fingerprint live on the scope, NOT on a plain
      // options object — this is the v8 shape.
      Sentry.captureException(error, (scope) => {
        scope.setLevel(toSentryLevel(decision.level));
        // (2) Stable grouping: the resolved decision fingerprint (operation·code·interaction),
        // else one issue per error code — never per stack frame.
        scope.setFingerprint([...(decision.fingerprint ?? [error.code])]);
        scope.setTags({
          ...decision.tags,
          code: error.code,
          // 구 isExpectedCode → catalog category(P5/P6): business = expected.
          expected: String(
            isKnownErrorCode(error.code) &&
              CANONICAL_ERROR_SEMANTICS[error.code].category === "business",
          ),
          runtime: ctx.runtime,
          ...(ctx.correlationId ? { correlationId: ctx.correlationId } : {}),
        });
        // (1) details redacted by the SAME allowlist that gates the client DTO.
        scope.setContext("app", {
          route: ctx.route ?? null,
          details: gateClientDetails(error.code, error.details) ?? "[gated]",
          droppedByThrottle: fromBrowserBoundary ? browserBucket.droppedSinceLastAllow() : 0,
          // RUNNING total of throttled drops — lets a rate-limited aggregate
          // `throttled{droppedCount}` be read off the live reporter (G4/G5).
          droppedTotal: browserBucket.droppedTotal(),
        });
        // User: id + role only — NEVER email/PII (scrubbed defensively in beforeSend too).
        scope.setUser(
          ctx.user ? { id: ctx.user.id, ...(ctx.user.role ? { role: ctx.user.role } : {}) } : null,
        );
        return scope;
      });
    },
    // (G5) T1 impact breadcrumb — NOT a re-capture. A breadcrumb attaches to the
    // NEXT captured event in this scope, stitching the user-visible impact to the
    // error via correlationId. category "error.presented" so it's filterable.
    // surface는 resolveTelemetry가 decision.tags.surface로 실어준다(ReporterSink 계약 불변).
    breadcrumb(error: AppError, decision: TelemetryDecision, ctx: TelemetryContext) {
      Sentry.addBreadcrumb({
        category: "error.presented",
        level: "info",
        data: {
          code: error.code,
          surface: decision.tags?.surface ?? null,
          correlationId: ctx.correlationId ?? null,
        },
      });
    },
    setUser(user) {
      Sentry.setUser(user ? { id: user.id, ...(user.role ? { role: user.role } : {}) } : null);
    },
    setContext(ctx) {
      if (ctx.correlationId) Sentry.setTag("correlationId", ctx.correlationId);
    },
    droppedTotal: () => browserBucket.droppedTotal(),
  };
};

/**
 * Wire this once at the composition root (instrumentation-client.ts / instrumentation.ts).
 * `beforeSend` is the LAST line of PII defense — it runs on EVERY event, including those
 * Sentry auto-captures outside our Reporter.
 */
export const sentryBeforeSend = (event: Sentry.ErrorEvent): Sentry.ErrorEvent | null => {
  if (event.user) {
    const { id } = event.user;
    // @sentry/nextjs v8: event.user is `User | undefined` (not `| null`); clear with undefined.
    event.user = id ? { id: String(id) } : undefined; // drop email/ip_address/username
  }
  if (event.extra) event.extra = scrubDeep(event.extra) as Record<string, unknown>;
  if (event.contexts) event.contexts = scrubDeep(event.contexts) as typeof event.contexts;
  if (event.request?.headers) {
    for (const h of Object.keys(event.request.headers)) {
      if (PII_KEYS.has(h.toLowerCase())) event.request.headers[h] = "[redacted]";
    }
    delete event.request.cookies;
  }
  if (event.message) event.message = scrubString(event.message);
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = scrubString(ex.value);
  }
  return event;
};
