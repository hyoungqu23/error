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

// 전송하는 sink: capture가 명시적 `true`를 반환한다(전송됨 — Codex P1). undefined(legacy void)는
// 이제 "전송 주장 없음"으로 비전송 취급이므로, "sent → composite true" 단언은 true 반환을 요구한다.
const makeSink = () => {
  const capture = vi.fn((..._args: unknown[]): boolean => true);
  const breadcrumb = vi.fn();
  const sink: ReporterSink = {
    capture: (e, d, c) => capture(e, d, c),
    breadcrumb: (e, d, c) => breadcrumb(e, d, c),
  };
  return { sink, capture, breadcrumb };
};

/** 반환 없이 전송하는 legacy void sink(undefined 반환) — 이제 비전송으로 집계된다(Codex P1). */
const legacyVoidSink = (): ReporterSink => ({
  capture: () => undefined,
  breadcrumb() {},
});

const throwingSink = (message = "sink down"): ReporterSink => ({
  capture() {
    throw new Error(message);
  },
  breadcrumb() {
    throw new Error(message);
  },
});

/** capture가 throw 없이 false를 반환하는 sink(throttle-drop / 전송 실패 모사). */
const droppingSink = (): ReporterSink => ({
  capture: () => false,
  breadcrumb() {},
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
  it("never throws and breadcrumb is a no-op", () => {
    expect(() => noopReporter.capture(ERR, DECISION, CTX)).not.toThrow();
    expect(noopReporter.breadcrumb(ERR, DECISION, CTX)).toBeUndefined();
  });

  it("capture returns false (no remote send → pipeline must NOT mark; auto-capture stays the safety net)", () => {
    expect(noopReporter.capture(ERR, DECISION, CTX)).toBe(false);
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

  // ── capture 반환 프로토콜 집계 의미론(OR — 원격 전송 도달 여부, 가시성 fail-open) ────────────
  // 어느 한 sink라도 명시적 true를 반환(전송됨 — Codex P1)했으면 composite.capture는 true(파이프라인
  // 마킹 → 자동 캡처본 드롭). 전부 throw(guard가 삼킴)/false(비-원격 sink·throttle-drop 포함)/
  // undefined(legacy void sink)여야 false(비마킹 → 자동 캡처 안전망 생존). 가시성은 별개로 throw
  // 카운트(health())가 담당한다.
  it("capture returns true when sinks sent (explicit true)", () => {
    const a = makeSink(); // capture → true = sent
    const b = makeSink();
    const guarded = guardedCompositeReporter([
      { label: "a", reporter: a.sink },
      { label: "b", reporter: b.sink },
    ]);

    expect(guarded.capture(ERR, DECISION, CTX)).toBe(true);
    expect(guarded.health().totalFailures).toBe(0);
  });

  // ── Codex P1 봉인: legacy void sink(undefined)는 전송으로 집계되지 않는다 ──
  // throttle-drop(false)하는 원격 sink + legacy void sink만 있으면 명시적 true가 없으므로
  // composite=false(비마킹) — 과거 'undefined=전송' 집계가 스톰 시 0건을 부활시킨 결함을 봉인한다.
  it("capture returns false when only a throttle-drop(false) + legacy void(undefined) sink (Codex P1)", () => {
    const guarded = guardedCompositeReporter([
      { label: "sentry", reporter: droppingSink() }, // false = throttle-drop
      { label: "legacy", reporter: legacyVoidSink() }, // undefined = 전송 주장 없음
    ]);

    expect(guarded.capture(ERR, DECISION, CTX)).toBe(false);
    expect(guarded.health().totalFailures).toBe(0); // false/undefined는 throw가 아니므로 실패 0.
  });

  it("capture returns false ONLY when NO sink sent (every sink dropped/threw)", () => {
    const guarded = guardedCompositeReporter([
      { label: "sentry", reporter: droppingSink() }, // false = throttle-drop
      { label: "console", reporter: droppingSink() }, // false = 비-원격 sink
    ]);

    expect(guarded.capture(ERR, DECISION, CTX)).toBe(false);
    expect(guarded.health().totalFailures).toBe(0); // false 반환은 "실패"가 아니다(throw만 카운트).
  });

  // ── 불변식(P0b 리뷰 blocker #1): 비-원격 sink(console/noop: false)는 원격 sink(Sentry: true)의
  // 마킹을 깔아뭉개지 않는다. OR 집계이므로, sentry=true + console=false → composite=true(마킹).
  // 레퍼런스 프로덕션 배선(Sentry+console guarded composite)에서 정상 캡처마다 이중 보고를 막는
  // dedupe 마커가 살아 있도록 하는 핵심 계약이다(과거 AND-부정 집계는 이를 영구 무력화했다).
  it("a non-remote sink (console=false) does NOT smother a remote sink (sentry=true) marking", () => {
    const sentryLike: ReporterSink = { capture: () => true, breadcrumb() {} }; // 전송 성공
    const guarded = guardedCompositeReporter([
      { label: "sentry", reporter: sentryLike },
      { label: "console", reporter: droppingSink() }, // 비-원격 → false
    ]);

    expect(guarded.capture(ERR, DECISION, CTX)).toBe(true); // OR: sentry가 보냈으므로 마킹.
    expect(guarded.health().totalFailures).toBe(0);
  });

  it("capture returns false when the ONLY remote sink throttle-drops (no other sink sent)", () => {
    // throttle-drop 0건 결함 봉인: 단독 Sentry가 false면 마킹할 전송이 없어 composite=false →
    // 자동 캡처 안전망 생존.
    const guarded = guardedCompositeReporter([{ label: "sentry", reporter: droppingSink() }]);

    expect(guarded.capture(ERR, DECISION, CTX)).toBe(false);
  });

  it("capture returns true when SOME sink sent even if another throws (others still reached remote)", () => {
    const healthy = makeSink(); // true = sent
    const guarded = guardedCompositeReporter([
      { label: "down", reporter: throwingSink() },
      { label: "up", reporter: healthy.sink },
    ]);

    expect(guarded.capture(ERR, DECISION, CTX)).toBe(true); // up이 전송 → 마킹.
    expect(healthy.capture).toHaveBeenCalledTimes(1);
    expect(guarded.health().failures.get("down")).toBe(1); // 가시성은 throw 카운트가 유지.
  });

  it("capture returns false when the ONLY sink throws (guarded-swallow → nothing sent)", () => {
    // 단일 sentry sink가 throw → guard가 삼켜 handle-error는 throw를 못 보지만, 전송된 sink가
    // 없으므로 composite=false → 비마킹 → 자동 캡처 안전망 생존(pipeline-captured (h) 봉인).
    const guarded = guardedCompositeReporter([{ label: "sentry", reporter: throwingSink() }]);

    expect(guarded.capture(ERR, DECISION, CTX)).toBe(false);
    expect(guarded.health().failures.get("sentry")).toBe(1);
  });
});

describe("compositeReporter (legacy variadic) capture-return aggregation (OR)", () => {
  it("returns true if ANY sink sent, false only when none sent", () => {
    const a = makeSink();
    const b = makeSink();
    // 둘 다 전송 → true.
    expect(compositeReporter(a.sink, b.sink).capture(ERR, DECISION, CTX)).toBe(true);
    // 하나만 전송(다른 하나는 false/throw) → OR로 true.
    expect(compositeReporter(makeSink().sink, droppingSink()).capture(ERR, DECISION, CTX)).toBe(true);
    expect(compositeReporter(makeSink().sink, throwingSink()).capture(ERR, DECISION, CTX)).toBe(true);
    // 아무도 전송 안 함 → false.
    expect(compositeReporter(droppingSink(), throwingSink()).capture(ERR, DECISION, CTX)).toBe(false);
    // Codex P1: legacy void sink(undefined)만 끼면 명시적 true가 없어 false(전송 주장 없음).
    expect(compositeReporter(legacyVoidSink(), droppingSink()).capture(ERR, DECISION, CTX)).toBe(false);
  });
});
