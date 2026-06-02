// §10 — composite reporter (guarded fan-out + dead-man's-switch + noop)
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  compositeReporter,
  noopReporter,
  guardedCompositeReporter,
} from "@/error/adapters/composite";
import { construct } from "@/error/app-error";
import type { Reporter, TelemetryContext } from "@/error/telemetry";
import type { DomainError } from "@/error/app-error";

// --- Fixtures ---------------------------------------------------------------
// OFFLINE takes `null` details — a trivially-valid DomainError for fan-out args.
// P3b-ii: the composite Reporter is the OLD sink (typed over DomainError) and stays on the
// old stack until P3e; build the fixture via the old `construct` (makeError now → AppError).
const error: DomainError = construct("OFFLINE", null);
const ctx: TelemetryContext = { runtime: "server" };

const makeSpyReporter = (): Reporter => ({
  report: vi.fn(),
  breadcrumb: vi.fn(),
  setUser: vi.fn(),
  setContext: vi.fn(),
});

describe("compositeReporter (legacy variadic, guarded)", () => {
  it("calls report() on every reporter and forwards the same args", () => {
    const a = makeSpyReporter();
    const b = makeSpyReporter();
    const composite = compositeReporter(a, b);

    composite.report(error, "error", ctx);

    expect(a.report).toHaveBeenCalledTimes(1);
    expect(b.report).toHaveBeenCalledTimes(1);
    expect(a.report).toHaveBeenCalledWith(error, "error", ctx);
    expect(b.report).toHaveBeenCalledWith(error, "error", ctx);
  });

  it("a throwing reporter does NOT prevent the other reporter from being called", () => {
    const throwing: Reporter = {
      report: vi.fn(() => {
        throw new Error("sink-1 exploded");
      }),
      breadcrumb: vi.fn(),
      setUser: vi.fn(),
      setContext: vi.fn(),
    };
    const healthy = makeSpyReporter();
    const composite = compositeReporter(throwing, healthy);

    composite.report(error, "error", ctx);

    expect(throwing.report).toHaveBeenCalledTimes(1);
    // The throw from sink-1 must not short-circuit fan-out to sink-2.
    expect(healthy.report).toHaveBeenCalledTimes(1);
    expect(healthy.report).toHaveBeenCalledWith(error, "error", ctx);
  });

  it("no exception escapes compositeReporter.report() (telemetry never throws)", () => {
    const throwing: Reporter = {
      report: () => {
        throw new Error("boom");
      },
      breadcrumb: () => {
        throw new Error("boom");
      },
      setUser: () => {
        throw new Error("boom");
      },
      setContext: () => {
        throw new Error("boom");
      },
    };
    const composite = compositeReporter(throwing);

    expect(() => composite.report(error, "error", ctx)).not.toThrow();
    expect(() => composite.breadcrumb(error, "toast", ctx)).not.toThrow();
    expect(() => composite.setUser({ id: "u1" })).not.toThrow();
    expect(() => composite.setContext({ route: "/x" })).not.toThrow();
  });

  it("guards setUser and setContext fan-out across all reporters too", () => {
    const throwing: Reporter = {
      report: vi.fn(),
      breadcrumb: vi.fn(),
      setUser: vi.fn(() => {
        throw new Error("nope");
      }),
      setContext: vi.fn(() => {
        throw new Error("nope");
      }),
    };
    const healthy = makeSpyReporter();
    const composite = compositeReporter(throwing, healthy);

    expect(() => composite.setUser({ id: "u1" })).not.toThrow();
    expect(() => composite.setContext({ route: "/x" })).not.toThrow();

    expect(healthy.setUser).toHaveBeenCalledWith({ id: "u1" });
    expect(healthy.setContext).toHaveBeenCalledWith({ route: "/x" });
  });

  it("fans breadcrumb() out to every reporter and forwards the same args (guarded)", () => {
    const a = makeSpyReporter();
    const b = makeSpyReporter();
    const composite = compositeReporter(a, b);

    composite.breadcrumb(error, "toast", ctx);

    expect(a.breadcrumb).toHaveBeenCalledWith(error, "toast", ctx);
    expect(b.breadcrumb).toHaveBeenCalledWith(error, "toast", ctx);
  });

  it("a throwing breadcrumb() does NOT prevent the other reporter's breadcrumb", () => {
    const throwing: Reporter = {
      report: vi.fn(),
      breadcrumb: vi.fn(() => {
        throw new Error("crumb exploded");
      }),
      setUser: vi.fn(),
      setContext: vi.fn(),
    };
    const healthy = makeSpyReporter();
    const composite = compositeReporter(throwing, healthy);

    expect(() => composite.breadcrumb(error, "inline", ctx)).not.toThrow();
    expect(throwing.breadcrumb).toHaveBeenCalledTimes(1);
    expect(healthy.breadcrumb).toHaveBeenCalledWith(error, "inline", ctx);
  });
});

describe("noopReporter", () => {
  it("is a no-op: every method returns undefined and never throws", () => {
    expect(noopReporter.report(error, "error", ctx)).toBeUndefined();
    expect(noopReporter.breadcrumb(error, "toast", ctx)).toBeUndefined();
    expect(noopReporter.setUser({ id: "u1" })).toBeUndefined();
    expect(noopReporter.setUser(null)).toBeUndefined();
    expect(noopReporter.setContext({ runtime: "client" })).toBeUndefined();
    expect(() => {
      noopReporter.report(error, "fatal", ctx);
      noopReporter.breadcrumb(error, "silent", ctx);
      noopReporter.setUser({ id: "u" });
      noopReporter.setContext({});
    }).not.toThrow();
  });
});

describe("guardedCompositeReporter (dead-man's-switch / health accounting)", () => {
  // The dead-man's-switch writes a last-resort line to process.stderr.write.
  // Stub it so the failure path is observable and silent.
  let stderrWrite: ReturnType<typeof vi.fn>;
  let originalWrite: typeof process.stderr.write;

  beforeEach(() => {
    stderrWrite = vi.fn();
    originalWrite = process.stderr.write;
    // Cast through unknown — we only exercise the (s: string) => void path the source uses.
    process.stderr.write = stderrWrite as unknown as typeof process.stderr.write;
  });

  afterEach(() => {
    process.stderr.write = originalWrite;
    vi.restoreAllMocks();
  });

  it("a throwing sink does NOT prevent the other sink from being called", () => {
    const throwing: Reporter = {
      report: vi.fn(() => {
        throw new Error("kaboom");
      }),
      breadcrumb: vi.fn(),
      setUser: vi.fn(),
      setContext: vi.fn(),
    };
    const healthy = makeSpyReporter();
    const composite = guardedCompositeReporter([
      { label: "sentry", reporter: throwing },
      { label: "console", reporter: healthy },
    ]);

    expect(() => composite.report(error, "error", ctx)).not.toThrow();
    expect(throwing.report).toHaveBeenCalledTimes(1);
    expect(healthy.report).toHaveBeenCalledWith(error, "error", ctx);
  });

  it("increments the per-sink failure counter when an adapter throws", () => {
    const throwing: Reporter = {
      report: () => {
        throw new Error("kaboom");
      },
      breadcrumb() {},
      setUser() {},
      setContext() {},
    };
    const composite = guardedCompositeReporter([
      { label: "sentry", reporter: throwing },
    ]);

    // Healthy before any failure.
    expect(composite.health().failures.get("sentry")).toBeUndefined();
    expect(composite.health().lastFailureAt).toBeUndefined();

    composite.report(error, "error", ctx);
    expect(composite.health().failures.get("sentry")).toBe(1);

    composite.report(error, "error", ctx);
    expect(composite.health().failures.get("sentry")).toBe(2);

    // setUser/setContext failures are accounted under the same label.
    const throwingAll: Reporter = {
      report() {},
      breadcrumb() {},
      setUser: () => {
        throw new Error("x");
      },
      setContext: () => {
        throw new Error("x");
      },
    };
    const c2 = guardedCompositeReporter([{ label: "sink", reporter: throwingAll }]);
    c2.setUser({ id: "u" });
    c2.setContext({ route: "/r" });
    expect(c2.health().failures.get("sink")).toBe(2);
  });

  it("does not count failures for healthy sinks", () => {
    const healthy = makeSpyReporter();
    const composite = guardedCompositeReporter([
      { label: "ok", reporter: healthy },
    ]);

    composite.report(error, "error", ctx);
    composite.setUser({ id: "u" });
    composite.setContext({ route: "/r" });

    expect(composite.health().failures.get("ok")).toBeUndefined();
    expect(composite.health().lastFailureAt).toBeUndefined();
  });

  it("health() returns a defensive copy — mutating it does not corrupt internal state", () => {
    const throwing: Reporter = {
      report: () => {
        throw new Error("kaboom");
      },
      breadcrumb() {},
      setUser() {},
      setContext() {},
    };
    const composite = guardedCompositeReporter([
      { label: "sentry", reporter: throwing },
    ]);
    composite.report(error, "error", ctx);

    const snapshot = composite.health();
    expect(snapshot.failures.get("sentry")).toBe(1);
    (snapshot.failures as Map<string, number>).set("sentry", 999);

    // A fresh snapshot reflects the true internal count, not the caller's mutation.
    expect(composite.health().failures.get("sentry")).toBe(1);
  });

  it("emits a throttled last-resort line via stderr and respects alertThrottleMs", () => {
    const throwing: Reporter = {
      report: () => {
        throw new Error("kaboom");
      },
      breadcrumb() {},
      setUser() {},
      setContext() {},
    };
    // Throttle gate is `lastFailureAt - lastAlertAt >= throttleMs`, with the
    // initial lastAlertAt = 0. So the first emission only fires once the clock
    // reaches the throttle window measured from 0.
    let clock = 6000;
    const composite = guardedCompositeReporter(
      [{ label: "sentry", reporter: throwing }],
      { alertThrottleMs: 5000, now: () => clock },
    );

    composite.report(error, "error", ctx); // 6000 - 0 >= 5000 → emits
    expect(stderrWrite).toHaveBeenCalledTimes(1);
    const firstLine = stderrWrite.mock.calls[0]?.[0] as string;
    expect(firstLine).toContain("telemetry-dead-mans-switch");
    expect(firstLine).toContain("sentry");

    clock = 8000; // 8000 - 6000 = 2000 < 5000 → suppressed, but still counted
    composite.report(error, "error", ctx);
    expect(stderrWrite).toHaveBeenCalledTimes(1);
    expect(composite.health().failures.get("sentry")).toBe(2);

    clock = 13000; // 13000 - 6000 = 7000 >= 5000 → emits again
    composite.report(error, "error", ctx);
    expect(stderrWrite).toHaveBeenCalledTimes(2);
    expect(composite.health().lastFailureAt).toBe(13000);
  });

  it("health().totalFailures is a RUNNING total that does NOT reset when a sink later allows", () => {
    // G4: the running swallowed-failure total must not be zeroed by an intervening
    // success. A sink that fails, then succeeds (allows), then fails again must show
    // a monotonically increasing total of 2 — not 1 (which a reset-on-allow bug yields).
    let mode: "throw" | "ok" = "throw";
    const flaky: Reporter = {
      report: () => {
        if (mode === "throw") throw new Error("kaboom");
      },
      breadcrumb() {},
      setUser() {},
      setContext() {},
    };
    const composite = guardedCompositeReporter([{ label: "sentry", reporter: flaky }]);

    composite.report(error, "error", ctx); // fail #1
    expect(composite.health().totalFailures).toBe(1);

    mode = "ok";
    composite.report(error, "error", ctx); // allow — must NOT reset the running total
    expect(composite.health().totalFailures).toBe(1);
    // The per-sink counter is likewise not reset by the allow.
    expect(composite.health().failures.get("sentry")).toBe(1);

    mode = "throw";
    composite.report(error, "error", ctx); // fail #2
    expect(composite.health().totalFailures).toBe(2);
    expect(composite.health().failures.get("sentry")).toBe(2);
  });

  it("totalFailures aggregates across DISTINCT sinks (running total, never reset)", () => {
    // Two sinks under one composite; the running total spans both labels.
    const throwingA: Reporter = {
      report: () => {
        throw new Error("a");
      },
      breadcrumb() {},
      setUser() {},
      setContext() {},
    };
    const throwingB: Reporter = {
      report: () => {
        throw new Error("b");
      },
      breadcrumb() {},
      setUser() {},
      setContext() {},
    };
    const composite = guardedCompositeReporter([
      { label: "sentry", reporter: throwingA },
      { label: "console", reporter: throwingB },
    ]);

    composite.report(error, "error", ctx); // both fail → +2
    expect(composite.health().totalFailures).toBe(2);
    composite.report(error, "error", ctx); // both fail again → +2
    expect(composite.health().totalFailures).toBe(4);
    expect(composite.health().failures.get("sentry")).toBe(2);
    expect(composite.health().failures.get("console")).toBe(2);
  });
});
