// 파이프라인 캡처 소유 마커(§Phase 0b) — createHandleError가 capture 결정일 때 "원본 input"을
// 마킹하는지 특성화한다. 핵심 계약:
//   (a) capture:true 결정 → 원본 input이 marked(non-AppError 입력이 wrapped되어도 원본 기준),
//   (b) capture:false(telemetry override) → not marked(샘플 아웃이 아니라 capture 자체가 꺼진 경우),
//   (c) 원시값 입력(문자열 throw) → no-throw(WeakSet 키가 될 수 없으므로 조용히 무시).
// 마킹은 "원격 관측 시스템에 실제로 전송된 경우"에만 걸린다(capture 반환 프로토콜) — 비전송 경로는
// 모두 비마킹이라 자동 캡처가 안전망으로 산다: (d) sample-out · (e) sink-throw · (g) throttle-drop
// (false 반환) · (h) guarded-swallow(composite false).
import { describe, it, expect, vi } from "vitest";

import { createHandleError } from "@/error/handle-error";
import { createDecisionSystem } from "@/error/decision/system";
import { CANONICAL_ERROR_SEMANTICS } from "@/error/decision/catalog";
import { appError } from "@/error/decision/app-error";
import { guardedCompositeReporter } from "@/error/adapters/composite";
import { createConsoleReporter } from "@/error/adapters/console-reporter";
import { isPipelineCaptured } from "@/error/pipeline-captured";
import type {
  ReporterSink,
  NotifierSink,
  TelemetryContext,
  OccurrenceContext,
} from "@/error/decision/types";

const OPERATIONS = {
  "product.read": {
    operation: "product.read",
    owner: "catalog",
    criticality: "core",
    defaultUiScope: "page",
    piiRisk: false,
  },
} as const;

const makeSystem = () =>
  createDecisionSystem({
    errors: CANONICAL_ERROR_SEMANTICS,
    operations: OPERATIONS,
    fallbackErrorCode: "UNKNOWN_SERVER_ERROR",
    defaultRuntime: "server",
  });

const BASE_CTX: TelemetryContext = {
  runtime: "server",
  operation: "product.read",
  correlationId: "c",
  user: null,
};

const BASE_OCCURRENCE: OccurrenceContext = {
  operation: "product.read",
  interaction: "query",
  uiScope: "page",
  criticality: "core",
};

// capture는 명시적 `true`를 반환한다(전송됨 — Codex P1). undefined(legacy void) 반환은 이제
// "전송 주장 없음"으로 비마킹이므로, "sent → marks" 단언이 의도대로 작동하려면 true가 필요하다.
const makeSinks = () => {
  const reporter: ReporterSink = { capture: vi.fn(() => true), breadcrumb: vi.fn() };
  const notifier: NotifierSink = { alert: vi.fn() };
  return { reporter, notifier };
};

describe("pipeline-captured marker (§Phase 0b)", () => {
  it("(a) capture:true → marks the ORIGINAL input (a wrapped non-AppError still marks its original)", () => {
    const handle = createHandleError(makeSystem(), makeSinks(), BASE_CTX, BASE_OCCURRENCE);
    const original = new TypeError("boom"); // non-AppError → finalizeUnknown wraps it

    const failure = handle(original);

    // capture:true가 해소된 fault 코드 → 원본이 마킹된다(wrapped AppError가 아니라).
    expect(failure.decision.telemetry.capture).toBe(true);
    expect(isPipelineCaptured(original)).toBe(true);
    // wrapped AppError(다른 객체)는 마킹 대상이 아니다.
    expect(failure.error).not.toBe(original);
    expect(isPipelineCaptured(failure.error)).toBe(false);
  });

  it("(b) capture:false (telemetry override) → NOT marked", () => {
    const handle = createHandleError(makeSystem(), makeSinks(), BASE_CTX, BASE_OCCURRENCE);
    const original = appError("UNKNOWN_SERVER_ERROR");

    const failure = handle(original, { telemetry: { capture: false } });

    expect(failure.decision.telemetry.capture).toBe(false);
    expect(isPipelineCaptured(original)).toBe(false);
  });

  it("(c) a primitive input (thrown string) does not throw", () => {
    const handle = createHandleError(makeSystem(), makeSinks(), BASE_CTX, BASE_OCCURRENCE);

    expect(() => handle("just a string")).not.toThrow();
    // 원시값은 마킹되지 않으며(WeakSet 키 불가), 체크도 항상 false.
    expect(isPipelineCaptured("just a string")).toBe(false);
  });

  // ── P0b 리뷰 P1 봉인: 마킹은 capture "의도"가 아니라 "실제 실행"에 걸린다 ──
  // sample-out·sink-throw 시 파이프라인본이 Sentry에 가지 않았는데 마킹하면 자동 캡처본까지
  // 드롭되어 이벤트 0건(가시성 완전 상실)이 된다 — 두 경로 모두 비마킹이어야 자동 캡처가
  // 안전망으로 남는다.
  it("(d) sample-out (capture:true, sampleRate:0) → NOT marked (auto-capture stays as the safety net)", () => {
    const sinks = makeSinks();
    const handle = createHandleError(makeSystem(), sinks, BASE_CTX, BASE_OCCURRENCE);
    const original = new TypeError("sampled out");

    const failure = handle(original, { telemetry: { sampleRate: 0 } });

    // capture 의도는 true지만 sample-out으로 capture가 실행되지 않았다.
    expect(failure.decision.telemetry.capture).toBe(true);
    expect(sinks.reporter.capture).not.toHaveBeenCalled();
    expect(isPipelineCaptured(original)).toBe(false);
  });

  it("(e) reporter.capture throwing → NOT marked (a failed send must not suppress auto-capture)", () => {
    const reporter: ReporterSink = {
      capture: vi.fn(() => {
        throw new Error("sentry transport down");
      }),
      breadcrumb: vi.fn(),
    };
    const notifier: NotifierSink = { alert: vi.fn() };
    const handle = createHandleError(makeSystem(), { reporter, notifier }, BASE_CTX, BASE_OCCURRENCE);
    const original = new TypeError("capture will fail");

    expect(() => handle(original)).not.toThrow(); // guardSink가 sink throw를 삼킨다.
    expect(reporter.capture).toHaveBeenCalledTimes(1);
    expect(isPipelineCaptured(original)).toBe(false);
  });

  it("(f) an AppError input IS the captured error (input === failure.error) — both get the mark", () => {
    const handle = createHandleError(makeSystem(), makeSinks(), BASE_CTX, BASE_OCCURRENCE);
    const original = appError("HTTP_SERVER_ERROR");

    const failure = handle(original);

    // AppError 직접 입력은 wrapped되지 않으므로 파이프라인본의 originalException도 마킹된다 —
    // 이 경로에서 composeBeforeSend의 errsys.source 태그 가드가 파이프라인본을 살린다.
    expect(failure.error).toBe(original);
    expect(isPipelineCaptured(original)).toBe(true);
  });

  // ── capture 반환 프로토콜 봉인: 마킹은 "원격 전송 실제 발생" 시에만 ──
  // (스펙 (f)/(g)) throttle-drop(false 반환)·guarded-swallow(내부 sink throw → composite false)는
  // 파이프라인본이 Sentry에 도달하지 않은 경로이므로 비마킹이어야 자동 캡처가 안전망으로 산다.
  it("(g) capture returning false (throttle-drop) → NOT marked (auto-capture stays as the safety net)", () => {
    // capture가 throw 없이 false를 반환(스톰 throttle-drop / 전송 실패 모사).
    const reporter: ReporterSink = {
      capture: vi.fn(() => false),
      breadcrumb: vi.fn(),
    };
    const notifier: NotifierSink = { alert: vi.fn() };
    const handle = createHandleError(makeSystem(), { reporter, notifier }, BASE_CTX, BASE_OCCURRENCE);
    const original = new TypeError("throttled out");

    const failure = handle(original);

    // capture 의도는 true이고 호출도 됐지만, false 반환이라 전송되지 않았다 → 비마킹.
    expect(failure.decision.telemetry.capture).toBe(true);
    expect(reporter.capture).toHaveBeenCalledTimes(1);
    expect(isPipelineCaptured(original)).toBe(false);
  });

  it("(h) guardedCompositeReporter swallowing a sink throw → composite returns false → NOT marked", () => {
    // guarded 배선(레퍼런스 기본)에서 단독 sink가 throw하면 guard가 삼켜 handle-error는 throw를
    // 못 본다 — 전송된 sink가 없으므로 composite capture가 false를 반환해 비마킹이어야 한다.
    const reporter = guardedCompositeReporter([
      {
        label: "sentry",
        reporter: {
          capture() {
            throw new Error("sentry transport down");
          },
          breadcrumb() {},
        },
      },
    ]);
    const notifier: NotifierSink = { alert: vi.fn() };
    const handle = createHandleError(makeSystem(), { reporter, notifier }, BASE_CTX, BASE_OCCURRENCE);
    const original = new TypeError("guarded swallow");

    expect(() => handle(original)).not.toThrow(); // guard가 sink throw를 삼킨다.
    // composite가 false를 반환 → 파이프라인본이 Sentry에 못 갔으므로 비마킹.
    expect(reporter.health().failures.get("sentry")).toBe(1);
    expect(isPipelineCaptured(original)).toBe(false);
  });

  // ── P0b 리뷰 blocker #1 봉인: 문서화된 프로덕션 배선(Sentry+console guarded composite)에서
  // dedupe 마커가 살아 있어야 한다(이중 보고 방지). 비-원격 sink(console: false)가 원격 sink
  // (Sentry: true)의 마킹을 깔아뭉개면 안 된다 — OR 집계가 이를 보장한다.
  it("(i) reference wiring (sentry SENT + console) → MARKS (composeBeforeSend can drop the auto-capture copy)", () => {
    const sentryLike: ReporterSink = { capture: () => true, breadcrumb: () => {} }; // 원격 전송 성공
    const reporter = guardedCompositeReporter([
      { label: "sentry", reporter: sentryLike },
      { label: "console", reporter: createConsoleReporter() }, // 비-원격 → false
    ]);
    const notifier: NotifierSink = { alert: vi.fn() };
    const handle = createHandleError(makeSystem(), { reporter, notifier }, BASE_CTX, BASE_OCCURRENCE);
    const original = new TypeError("normal fault, sentry up");

    handle(original);
    // OR: sentry가 전송했으므로 console의 false에도 불구하고 마킹된다 → 자동 캡처본 드롭(이중 보고 차단).
    expect(isPipelineCaptured(original)).toBe(true);
  });

  // ── Codex P1 봉인: legacy void sink(undefined 반환)는 "전송됨"으로 집계되지 않는다 ──
  // 과거엔 undefined를 전송으로 간주해서, composite에 throttle-drop(false)하는 원격 sink와 legacy
  // void sink가 함께 있으면 void의 undefined가 OR을 true로 올려 마킹→자동 캡처본 드롭→스톰 시
  // 이벤트 0건이 부활했다. 이제 명시적 true만 전송으로 집계하므로 이 구성은 composite=false → 비마킹.
  it("(j) composite [throttle-drop(false) + legacy void(undefined)] → composite false → NOT marked (Codex P1)", () => {
    const throttleDrop: ReporterSink = { capture: () => false, breadcrumb() {} }; // Sentry storm throttle-drop
    const legacyVoid: ReporterSink = { capture: () => undefined, breadcrumb() {} }; // legacy void sink
    const reporter = guardedCompositeReporter([
      { label: "sentry", reporter: throttleDrop },
      { label: "legacy", reporter: legacyVoid },
    ]);
    const notifier: NotifierSink = { alert: vi.fn() };
    const handle = createHandleError(makeSystem(), { reporter, notifier }, BASE_CTX, BASE_OCCURRENCE);
    const original = new TypeError("storm + legacy void sink");

    handle(original);
    // 어느 sink도 명시적 true를 반환하지 않았다 → composite false → 비마킹 → 자동 캡처 안전망 생존.
    expect(reporter.health().totalFailures).toBe(0); // false/undefined는 throw가 아니므로 실패 카운트 0.
    expect(isPipelineCaptured(original)).toBe(false);
  });
});
