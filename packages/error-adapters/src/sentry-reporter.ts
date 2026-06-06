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
  isPipelineCaptured,
  pickAllowlistedDetails,
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
  // 클라 DTO를 게이트하는 것과 동일한 단일 구현(error-core pickAllowlistedDetails) — drift 불가.
  return pickAllowlistedDetails(details, allowlist);
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
        // (2) Stable grouping: the resolved decision fingerprint [operation, code, interaction]
        // (D-P6-3 — 의도적으로 구 per-code보다 세분화된 그룹핑; resolveTelemetry가 항상 채우므로
        // [error.code] 폴백은 hand-built decision에만 적용된다). Never per stack frame.
        scope.setFingerprint([...(decision.fingerprint ?? [error.code])]);
        scope.setTags({
          // D-P6-3: decision.tags(operation/criticality/surface)를 의도적으로 전송 — 운영 분류
          // 축이 Sentry 검색/대시보드에 필요. 예약 키(code/expected/runtime/correlationId)는
          // 아래 명시 값이 항상 이긴다(스프레드보다 뒤).
          ...decision.tags,
          // 파이프라인본 식별 — composeBeforeSend가 이 태그로 파이프라인본을 살리고(통과),
          // 같은 원본 에러의 "자동 캡처본"(이 태그 없음)을 드롭한다.
          "errsys.source": "pipeline",
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
  // P7(§8-5): tags/fingerprint도 마지막 방어선에 포함 — telemetry escape hatch(수동
  // fingerprint/tags override)나 Reporter 우회 자동수집 이벤트로 새는 PII까지 닫는다.
  if (event.tags) event.tags = scrubDeep(event.tags) as typeof event.tags;
  if (event.fingerprint) event.fingerprint = event.fingerprint.map((f) => scrubString(String(f)));
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

/** Sentry beforeSend의 사용자 정의 타입(동기 또는 PromiseLike, null로 드롭 가능). */
type BeforeSend = (
  event: Sentry.ErrorEvent,
  hint: Sentry.EventHint,
) => Sentry.ErrorEvent | PromiseLike<Sentry.ErrorEvent | null> | null;

/** 값이 PromiseLike(then 보유)인지 — 동기 경로를 동기로 유지하기 위한 좁힘. */
const isPromiseLike = <T>(v: T | PromiseLike<T>): v is PromiseLike<T> =>
  v != null && typeof (v as { then?: unknown }).then === "function";

/**
 * 합성 beforeSend(이식 설계 §PR2a) — 순서가 계약이다:
 * ① 파이프라인이 소유한(마커) 에러의 자동 캡처본 드롭(errsys.source !== "pipeline")
 * ② 대상의 기존 beforeSend(null 반환 시 단락)
 * ③ sentryBeforeSend PII 스크럽(마지막 방어선)
 *
 * existing이 PromiseLike를 반환하면 then으로 ③을 이어 붙인다(동기 경로는 동기 유지).
 */
export const composeBeforeSend =
  (existing?: BeforeSend): BeforeSend =>
  (event, hint) => {
    // ① 파이프라인 소유 에러의 "자동 캡처본"을 드롭한다(이중 캡처를 규약으로 차단).
    // 실제 메커니즘(P0b 리뷰로 정밀화): 마커는 createHandleError가 "원본 input"에 건다.
    //  - non-AppError 입력: 파이프라인본의 originalException은 wrapped AppError(비마킹)라
    //    isPipelineCaptured가 false → 첫 조건에서 단락 통과. 드롭되는 것은 원본을 rethrow한
    //    자동 캡처본(originalException === 마킹된 원본, 태그 없음)뿐이다.
    //  - AppError 직접 입력: input === failure.error라 파이프라인본의 originalException도
    //    마킹된다 — 이때는 errsys.source="pipeline" 태그 가드가 파이프라인본을 살린다.
    // 트레이드오프(수용됨): beforeSend는 transport 이전에 실행되므로, 파이프라인본의 네트워크
    // 전송이 실패하면 자동 캡처본은 이미 드롭된 뒤다(동반 유실 가능). 전송 신뢰성은
    // guardedCompositeReporter/dead-man's-switch가 담당한다. 단, 마킹 자체가 "capture가
    // 실제 실행된 경우"에만 걸리므로(sample-out·sink-throw 시 비마킹) 자동 캡처 안전망은
    // 그 경로들에서 살아 있다.
    if (
      isPipelineCaptured(hint.originalException) &&
      event.tags?.["errsys.source"] !== "pipeline"
    ) {
      return null;
    }

    // ② 대상의 기존 beforeSend. null 반환 시 단락(③ 스크럽도 건너뛴다).
    const afterExisting = existing ? existing(event, hint) : event;
    if (afterExisting === null) return null;

    // ③ PII 스크럽은 마지막 방어선 — existing이 비동기면 await 후 적용(동기는 동기 유지).
    if (isPromiseLike(afterExisting)) {
      return afterExisting.then((e) => (e === null ? null : sentryBeforeSend(e)));
    }
    return sentryBeforeSend(afterExisting);
  };
