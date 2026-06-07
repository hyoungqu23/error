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

import {
  createSentryReporter,
  sentryBeforeSend,
  composeBeforeSend,
} from "@/error/adapters/sentry-reporter";
import { makeError } from "@/error/make-error";
import { appError } from "@/error/decision/app-error";
import { markPipelineCaptured } from "@/error/pipeline-captured";
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
      // P7: telemetry escape hatch(수동 tags/fingerprint override) 경유 누출의 마지막 방어선.
      tags: { authorization: "Bearer top.secret.tok", plain: "ok" },
      fingerprint: ["checkout", "Bearer abc.def.ghi"],
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
    expect(event?.tags?.authorization).toBe("[redacted]");
    expect(event?.tags?.plain).toBe("ok");
    expect(JSON.stringify(event?.fingerprint)).not.toContain("abc.def.ghi");
    expect(event?.fingerprint?.[0]).toBe("checkout");
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

  // ── capture 반환 프로토콜 (이중 캡처 마커 dedupe 입력) ──────────────────────────────────
  // 마킹은 "원격 전송 실제 발생" 시에만 — throttle-drop은 false, 정상 전송은 true를 반환해야
  // 한다(handle-error tracking 래퍼가 captured = capture(...) !== false로 판정).
  it("capture returns false on a throttle-drop (so the pipeline does NOT mark → auto-capture survives)", () => {
    const reporter = createSentryReporter({ browserBurstCapacity: 1, browserRefillPerSec: 0 });
    const error = makeError({ code: "UNKNOWN_CLIENT_ERROR", details: null });
    const browserCtx: TelemetryContext = { ...CTX, runtime: "client", route: "window.onerror" };

    expect(reporter.capture(error, decision(), browserCtx)).toBe(true); // 1st — sent
    expect(reporter.capture(error, decision(), browserCtx)).toBe(false); // 2nd — throttle-drop
  });

  it("capture returns true when the event is actually sent (non-boundary route is never bucketed)", () => {
    const reporter = createSentryReporter();
    const error = makeError({ code: "HTTP_SERVER_ERROR", details: { status: 500 } });

    expect(reporter.capture(error, decision(), CTX)).toBe(true);
    expect(captureException).toHaveBeenCalledTimes(1);
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

// ── 0b — composeBeforeSend(이식 설계 §PR2a) 합성 순서/단락/스크럽 특성화 ─────────────────
describe("composeBeforeSend", () => {
  // Sentry EventHint(originalException만 사용)의 최소 형태.
  const hintFor = (originalException: unknown) =>
    ({ originalException }) as unknown as Parameters<ReturnType<typeof composeBeforeSend>>[1];
  const eventFor = (over: Record<string, unknown> = {}) =>
    ({ ...over }) as unknown as Parameters<ReturnType<typeof composeBeforeSend>>[0];

  it("(a) drops the AUTO-capture copy (no errsys.source tag) of a marked error", () => {
    const original = new Error("boom");
    markPipelineCaptured(original);

    const out = composeBeforeSend()(eventFor({ tags: { code: "X" } }), hintFor(original));

    expect(out).toBeNull();
  });

  it("(b) passes + scrubs a marked error's PIPELINE copy (errsys.source === 'pipeline')", () => {
    const original = new Error("boom");
    markPipelineCaptured(original);

    const out = composeBeforeSend()(
      eventFor({ tags: { "errsys.source": "pipeline" }, message: "Bearer abc.def.ghi" }),
      hintFor(original),
    ) as ReturnType<typeof sentryBeforeSend>;

    expect(out).not.toBeNull();
    // ③ 스크럽이 적용된 채로 통과한다.
    expect(out?.message).toBe("[redacted-token]");
  });

  it("(c) passes an UNMARKED error (errors outside the pipeline are preserved)", () => {
    const original = new Error("outside the pipeline");

    const out = composeBeforeSend()(eventFor({ message: "hi" }), hintFor(original));

    expect(out).not.toBeNull();
    expect((out as ReturnType<typeof sentryBeforeSend>)?.message).toBe("hi");
  });

  it("(d) short-circuits when the existing beforeSend returns null (no scrub — null)", () => {
    const dropAll = vi.fn(() => null);

    const out = composeBeforeSend(dropAll)(
      eventFor({ message: "Bearer abc.def.ghi" }),
      hintFor(new Error("x")),
    );

    expect(out).toBeNull();
    expect(dropAll).toHaveBeenCalledTimes(1);
  });

  it("(e) awaits an async existing (Promise) then applies the scrub", async () => {
    // existing이 PromiseLike를 반환하면 then으로 ③을 이어 붙인다.
    const asyncExisting = vi.fn((event: { message?: string }) =>
      Promise.resolve(event as Parameters<typeof sentryBeforeSend>[0]),
    );

    const out = await composeBeforeSend(asyncExisting)(
      eventFor({ message: "Bearer abc.def.ghi" }),
      hintFor(new Error("x")),
    );

    expect(out).not.toBeNull();
    expect(out?.message).toBe("[redacted-token]");
  });

  it("(f) actually applies the scrub (email/token removed) on the pass-through path", () => {
    const out = composeBeforeSend()(
      eventFor({
        user: { id: "u1", email: "user@example.com" },
        extra: { authorization: "Bearer abc.def.ghi" },
      }),
      hintFor(new Error("x")),
    ) as ReturnType<typeof sentryBeforeSend>;

    expect(out).not.toBeNull();
    expect(out?.user).toEqual({ id: "u1" }); // email dropped
    expect(out?.extra?.authorization).toBe("[redacted]");
  });
});
