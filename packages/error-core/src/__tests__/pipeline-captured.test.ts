// 파이프라인 캡처 소유 마커(§Phase 0b) — createHandleError가 capture 결정일 때 "원본 input"을
// 마킹하는지 특성화한다. 핵심 계약:
//   (a) capture:true 결정 → 원본 input이 marked(non-AppError 입력이 wrapped되어도 원본 기준),
//   (b) capture:false(telemetry override) → not marked(샘플 아웃이 아니라 capture 자체가 꺼진 경우),
//   (c) 원시값 입력(문자열 throw) → no-throw(WeakSet 키가 될 수 없으므로 조용히 무시).
import { describe, it, expect, vi } from "vitest";

import { createHandleError } from "@/error/handle-error";
import { createDecisionSystem } from "@/error/decision/system";
import { CANONICAL_ERROR_SEMANTICS } from "@/error/decision/catalog";
import { appError } from "@/error/decision/app-error";
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

const makeSinks = () => {
  const reporter: ReporterSink = { capture: vi.fn(), breadcrumb: vi.fn() };
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
});
