import { describe, expect, it, vi, beforeEach } from "vitest";

// ── @sentry/nextjs 목 (P6) — capture/breadcrumb 배선을 단정하기 위해 scope 콜백을 실행한다.
// sentryBeforeSend는 Sentry 타입만 참조(런타임 API 미사용)하므로 목과 무관하게 동작한다.
const scope = {
  setLevel: vi.fn(),
  setFingerprint: vi.fn(),
  setTags: vi.fn(),
  setContext: vi.fn(),
  setUser: vi.fn(),
};
const captureException = vi.fn((_e: unknown, cb?: unknown) => {
  if (typeof cb === "function") (cb as (s: typeof scope) => unknown)(scope);
  return "evt-id";
});
const addBreadcrumb = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureException: (e: unknown, cb?: unknown) => captureException(e, cb),
  addBreadcrumb: (b: unknown) => addBreadcrumb(b),
  setUser: vi.fn(),
  setTag: vi.fn(),
}));

import { createSentryReporter, sentryBeforeSend } from "@/error/adapters/sentry-reporter";
import { makeError } from "@/error/make-error";
import { appError } from "@/error/decision/app-error";
import type { TelemetryContext, TelemetryDecision } from "@/error/index";

const CTX: TelemetryContext = {
  runtime: "server",
  operation: "checkout",
  correlationId: "c1",
  user: null,
};

const decision = (over: Partial<TelemetryDecision> = {}): TelemetryDecision => ({
  capture: true,
  level: "error",
  breadcrumb: true,
  alert: false,
  ...over,
});

beforeEach(() => {
  captureException.mockClear();
  addBreadcrumb.mockClear();
  for (const fn of Object.values(scope)) fn.mockClear();
});

describe("sentryBeforeSend", () => {
  it("scrubs PII from user, extra, contexts, request headers, cookies, messages, and exceptions", () => {
    const event = sentryBeforeSend({
      user: {
        id: "u1",
        email: "user@example.com",
        ip_address: "127.0.0.1",
        username: "person",
      },
      extra: {
        authorization: "Bearer abc.def.ghi",
        nested: { token: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK" },
      },
      contexts: {
        app: {
          cookie: "sid=secret",
          safe: "value",
        },
      },
      request: {
        headers: {
          authorization: "Bearer top-secret",
          cookie: "sid=secret",
          "x-safe": "ok",
        },
        cookies: { sid: "secret" },
      },
      message: "failed with Bearer abc.def.ghi",
      exception: {
        values: [{ value: "token abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK leaked" }],
      },
    } as unknown as Parameters<typeof sentryBeforeSend>[0]);

    expect(event).not.toBeNull();
    expect(event?.user).toEqual({ id: "u1" });
    expect(event?.extra?.authorization).toBe("[redacted]");
    expect(JSON.stringify(event?.extra)).not.toContain("ABCDEFGHIJK");
    expect(JSON.stringify(event?.contexts)).not.toContain("sid=secret");
    expect(event?.request?.headers?.authorization).toBe("[redacted]");
    expect(event?.request?.headers?.cookie).toBe("[redacted]");
    expect(event?.request?.headers?.["x-safe"]).toBe("ok");
    expect(event?.request?.cookies).toBeUndefined();
    expect(event?.message).toBe("failed with [redacted-token]");
    expect(event?.exception?.values?.[0]?.value).toContain("[redacted-token]");
  });
});

// ── P6 — capture()/breadcrumb() ReporterSink 배선 특성화 (리뷰 [2][6] 보강) ──────────────
describe("createSentryReporter (P6 ReporterSink wiring)", () => {
  it("capture uses the resolved decision fingerprint when present", () => {
    const reporter = createSentryReporter();
    const error = makeError({ code: "NOT_FOUND", details: null });

    reporter.capture(error, decision({ fingerprint: ["checkout", "NOT_FOUND", "query"] }), CTX);

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(scope.setFingerprint).toHaveBeenCalledWith(["checkout", "NOT_FOUND", "query"]);
  });

  it("capture falls back to [error.code] for a hand-built decision without a fingerprint", () => {
    const reporter = createSentryReporter();
    const error = makeError({ code: "HTTP_SERVER_ERROR", details: { status: 500 } });

    reporter.capture(error, decision(), CTX);

    expect(scope.setFingerprint).toHaveBeenCalledWith(["HTTP_SERVER_ERROR"]);
  });

  it("merges decision.tags into Sentry tags — reserved keys (code/runtime) always win", () => {
    const reporter = createSentryReporter();
    const error = makeError({ code: "NOT_FOUND", details: null });

    reporter.capture(
      error,
      decision({
        tags: {
          operation: "checkout",
          criticality: "core",
          surface: "toast",
          code: "SPOOFED",
          runtime: "client",
        },
      }),
      CTX,
    );

    const tags = scope.setTags.mock.calls[0]![0] as Record<string, string>;
    expect(tags.operation).toBe("checkout");
    expect(tags.criticality).toBe("core");
    expect(tags.surface).toBe("toast");
    expect(tags.code).toBe("NOT_FOUND"); // reserved — never spoofable via decision.tags
    expect(tags.runtime).toBe("server");
    expect(tags.correlationId).toBe("c1");
  });

  it("tags.expected = catalog category 'business' (true) vs fault (false) vs unknown code (false)", () => {
    const reporter = createSentryReporter();

    reporter.capture(makeError({ code: "NOT_FOUND", details: null }), decision(), CTX);
    reporter.capture(makeError({ code: "HTTP_SERVER_ERROR", details: { status: 500 } }), decision(), CTX);
    reporter.capture(appError("TOTALLY_UNKNOWN", null), decision(), CTX);

    const expectedOf = (i: number) =>
      (scope.setTags.mock.calls[i]![0] as Record<string, string>).expected;
    expect(expectedOf(0)).toBe("true"); // business
    expect(expectedOf(1)).toBe("false"); // fault
    expect(expectedOf(2)).toBe("false"); // unknown — isKnownErrorCode gate
  });

  it("gates the 'app' context details by the catalog allowlist ([gated] for none/unknown)", () => {
    const reporter = createSentryReporter();

    // VALIDATION: fieldErrors allowlisted, sibling keys dropped.
    reporter.capture(
      makeError({ code: "VALIDATION", details: { fieldErrors: { email: ["required"] } } }),
      decision(),
      CTX,
    );
    // NOT_FOUND: detailsExposure none → "[gated]".
    reporter.capture(makeError({ code: "NOT_FOUND", details: { resource: "user" } }), decision(), CTX);
    // Unknown code → isKnownErrorCode gate → "[gated]".
    reporter.capture(appError("TOTALLY_UNKNOWN", { secret: "x" }), decision(), CTX);

    const appCtxOf = (i: number) =>
      (scope.setContext.mock.calls[i]![1] as Record<string, unknown>).details;
    expect(appCtxOf(0)).toEqual({ fieldErrors: { email: ["required"] } });
    expect(appCtxOf(1)).toBe("[gated]");
    expect(appCtxOf(2)).toBe("[gated]");
  });

  it("storm-throttles window-boundary events (bucketed by ctx.route)", () => {
    const reporter = createSentryReporter({ browserBurstCapacity: 1, browserRefillPerSec: 0 });
    const error = makeError({ code: "UNKNOWN_CLIENT_ERROR", details: null });
    const browserCtx: TelemetryContext = { ...CTX, runtime: "client", route: "window.onerror" };

    reporter.capture(error, decision(), browserCtx); // 1st — allowed
    reporter.capture(error, decision(), browserCtx); // 2nd — dropped by the bucket
    reporter.capture(error, decision(), CTX); // non-boundary route — NOT bucketed

    expect(captureException).toHaveBeenCalledTimes(2);
    expect(reporter.droppedTotal()).toBe(1);
  });

  it("breadcrumb reads surface from decision.tags.surface (null when absent)", () => {
    const reporter = createSentryReporter();
    const error = makeError({ code: "OFFLINE", details: null });

    reporter.breadcrumb(error, decision({ tags: { surface: "toast" } as Record<string, string> }), CTX);
    reporter.breadcrumb(error, decision(), CTX);

    expect(addBreadcrumb).toHaveBeenCalledTimes(2);
    const dataOf = (i: number) =>
      (addBreadcrumb.mock.calls[i]![0] as { data: Record<string, unknown> }).data;
    expect(dataOf(0)).toMatchObject({ code: "OFFLINE", surface: "toast", correlationId: "c1" });
    expect(dataOf(1)).toMatchObject({ code: "OFFLINE", surface: null });
  });
});
