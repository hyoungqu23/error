// §10 — adapters/composite.ts: guarded fan-out + dead-man's-switch health accounting.
// (P6: ReporterSink(capture/breadcrumb) 기반 재도입 — 구 Reporter(report/setUser/setContext)
//  테스트의 의도를 신 계약으로 보존한다. setUser/setContext는 계약에서 사라져 테스트도 제거.)
import { describe, it, expect, vi, afterEach } from "vitest";

import {
  compositeReporter,
  guardedCompositeReporter,
  noopReporter,
} from "@/error/adapters/composite";
import { appError } from "@/error/decision/app-error";
import type { ReporterSink, TelemetryContext, TelemetryDecision } from "@/error/index";

const ERR = appError("UNKNOWN_SERVER_ERROR", null, { correlationId: "c1" });
const DECISION: TelemetryDecision = { capture: true, level: "error", breadcrumb: true, alert: false };
const CTX: TelemetryContext = { runtime: "server", operation: "checkout", correlationId: "c1" };

const makeSink = () => {
  const capture = vi.fn();
  const breadcrumb = vi.fn();
  const sink: ReporterSink = {
    capture: (e, d, c) => capture(e, d, c),
    breadcrumb: (e, d, c) => breadcrumb(e, d, c),
  };
  return { sink, capture, breadcrumb };
};

const throwingSink = (message = "sink down"): ReporterSink => ({
  capture() {
    throw new Error(message);
  },
  breadcrumb() {
    throw new Error(message);
  },
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("compositeReporter (legacy variadic, guarded)", () => {
  it("calls capture() on every reporter and forwards the same args", () => {
    const a = makeSink();
    const b = makeSink();
    compositeReporter(a.sink, b.sink).capture(ERR, DECISION, CTX);

    expect(a.capture).toHaveBeenCalledWith(ERR, DECISION, CTX);
    expect(b.capture).toHaveBeenCalledWith(ERR, DECISION, CTX);
  });

  it("a throwing reporter does NOT prevent the other reporter from being called", () => {
    const healthy = makeSink();
    compositeReporter(throwingSink(), healthy.sink).capture(ERR, DECISION, CTX);
    expect(healthy.capture).toHaveBeenCalledTimes(1);
  });

  it("no exception escapes capture()/breadcrumb() (telemetry never throws)", () => {
    const composite = compositeReporter(throwingSink(), throwingSink());
    expect(() => composite.capture(ERR, DECISION, CTX)).not.toThrow();
    expect(() => composite.breadcrumb(ERR, DECISION, CTX)).not.toThrow();
  });

  it("fans breadcrumb() out to every reporter and forwards the same args (guarded)", () => {
    const a = makeSink();
    const b = makeSink();
    compositeReporter(a.sink, throwingSink(), b.sink).breadcrumb(ERR, DECISION, CTX);

    expect(a.breadcrumb).toHaveBeenCalledWith(ERR, DECISION, CTX);
    expect(b.breadcrumb).toHaveBeenCalledWith(ERR, DECISION, CTX);
  });
});

describe("noopReporter", () => {
  it("is a no-op: every method returns undefined and never throws", () => {
    expect(noopReporter.capture(ERR, DECISION, CTX)).toBeUndefined();
    expect(noopReporter.breadcrumb(ERR, DECISION, CTX)).toBeUndefined();
  });
});

describe("guardedCompositeReporter (dead-man's-switch / health accounting)", () => {
  it("a throwing sink does NOT prevent the other sink from being called", () => {
    const healthy = makeSink();
    const guarded = guardedCompositeReporter([
      { label: "down", reporter: throwingSink() },
      { label: "up", reporter: healthy.sink },
    ]);

    guarded.capture(ERR, DECISION, CTX);
    expect(healthy.capture).toHaveBeenCalledTimes(1);
  });

  it("a throwing breadcrumb() sink does NOT prevent the other sink's breadcrumb (guarded)", () => {
    const healthy = makeSink();
    const guarded = guardedCompositeReporter([
      { label: "down", reporter: throwingSink() },
      { label: "up", reporter: healthy.sink },
    ]);

    guarded.breadcrumb(ERR, DECISION, CTX);
    expect(healthy.breadcrumb).toHaveBeenCalledTimes(1);
  });

  it("increments the per-sink failure counter when an adapter throws", () => {
    const guarded = guardedCompositeReporter([{ label: "down", reporter: throwingSink() }]);

    guarded.capture(ERR, DECISION, CTX);
    guarded.breadcrumb(ERR, DECISION, CTX);

    expect(guarded.health().failures.get("down")).toBe(2);
    expect(guarded.health().totalFailures).toBe(2);
  });

  it("does not count failures for healthy sinks", () => {
    const healthy = makeSink();
    const guarded = guardedCompositeReporter([{ label: "up", reporter: healthy.sink }]);

    guarded.capture(ERR, DECISION, CTX);

    expect(guarded.health().failures.size).toBe(0);
    expect(guarded.health().totalFailures).toBe(0);
  });

  it("health() returns a defensive copy — mutating it does not corrupt internal state", () => {
    const guarded = guardedCompositeReporter([{ label: "down", reporter: throwingSink() }]);
    guarded.capture(ERR, DECISION, CTX);

    const snapshot = guarded.health();
    (snapshot.failures as Map<string, number>).set("down", 999);

    expect(guarded.health().failures.get("down")).toBe(1);
  });

  it("emits a throttled last-resort line via stderr and respects alertThrottleMs", () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    // lastAlertAt starts at 0, so the clock must start past the throttle window for the
    // FIRST failure to emit (matches real Date.now(), which is always ≫ throttleMs).
    let clock = 10_000;
    const guarded = guardedCompositeReporter([{ label: "down", reporter: throwingSink() }], {
      alertThrottleMs: 5_000,
      now: () => clock,
    });

    guarded.capture(ERR, DECISION, CTX); // t=10s → emits
    clock = 11_000;
    guarded.capture(ERR, DECISION, CTX); // within throttle window → suppressed
    clock = 16_000;
    guarded.capture(ERR, DECISION, CTX); // window elapsed → emits again

    const lines = write.mock.calls.map((c) => String(c[0]));
    const dms = lines.filter((l) => l.includes("[telemetry-dead-mans-switch]"));
    expect(dms).toHaveLength(2);
    expect(dms[0]).toContain('"sink":"down"');
    expect(dms[0]).toContain('"op":"capture"');
  });

  it("health().totalFailures is a RUNNING total that does NOT reset when a sink later succeeds", () => {
    let shouldThrow = true;
    const flaky: ReporterSink = {
      capture() {
        if (shouldThrow) throw new Error("flaky");
      },
      breadcrumb() {},
    };
    const guarded = guardedCompositeReporter([{ label: "flaky", reporter: flaky }], {
      alertThrottleMs: 0,
    });

    guarded.capture(ERR, DECISION, CTX); // fails → 1
    shouldThrow = false;
    guarded.capture(ERR, DECISION, CTX); // succeeds — counter must NOT reset

    expect(guarded.health().totalFailures).toBe(1);
    expect(guarded.health().failures.get("flaky")).toBe(1);
  });

  it("totalFailures aggregates across DISTINCT sinks (running total, never reset)", () => {
    const guarded = guardedCompositeReporter(
      [
        { label: "a", reporter: throwingSink() },
        { label: "b", reporter: throwingSink() },
      ],
      { alertThrottleMs: 0 },
    );

    guarded.capture(ERR, DECISION, CTX);

    expect(guarded.health().failures.get("a")).toBe(1);
    expect(guarded.health().failures.get("b")).toBe(1);
    expect(guarded.health().totalFailures).toBe(2);
  });
});
