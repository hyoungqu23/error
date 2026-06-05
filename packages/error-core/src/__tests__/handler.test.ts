// §8.1 — 클라이언트 싱글턴(handler.ts) 특성화 (P2 리뷰 보강: 이전까지 테스트 0).
// 핵심 계약: (1) init 전 handleError는 dev 가드로 throw, (2) correlationId가 ctx로 스레딩,
// (3) setErrorUser는 init "이후" 호출도 다음 handleError의 ctx.user에 즉시 반영(×5 패스가
//     독립 발견한 회귀 — user는 호출 시점에 주입된다), (4) 호출자 opts.ctx.user가 명시되면 우선.
import { describe, it, expect, vi, beforeEach } from "vitest";

import { initHandleError, handleError, setErrorUser } from "@/error/handler";
import { createDecisionSystem } from "@/error/decision/system";
import { CANONICAL_ERROR_SEMANTICS } from "@/error/decision/catalog";
import { appError } from "@/error/decision/app-error";
import type { ReporterSink, NotifierSink, TelemetryContext } from "@/error/index";

const makeDeps = () => {
  const capture = vi.fn();
  const reporter: ReporterSink = { capture: (e, d, c) => capture(e, d, c), breadcrumb() {} };
  const notifier: NotifierSink = { alert() {} };
  const system = createDecisionSystem({
    errors: CANONICAL_ERROR_SEMANTICS,
    operations: {
      unknown: {
        operation: "unknown",
        owner: "test",
        criticality: "normal",
        defaultUiScope: "page",
        piiRisk: false,
      },
    },
    fallbackErrorCode: "UNKNOWN_CLIENT_ERROR",
  });
  return { deps: { system, reporter, notifier }, capture };
};

/** capture가 받은 TelemetryContext (capture:true가 보장되는 fault 코드 사용). */
const ctxOf = (capture: ReturnType<typeof vi.fn>): TelemetryContext =>
  capture.mock.calls.at(-1)?.[2] as TelemetryContext;

beforeEach(() => {
  setErrorUser(null); // 모듈 싱글턴 상태 격리
});

describe("handler singleton (§8.1)", () => {
  it("threads the init correlationId into every handleError ctx", () => {
    const { deps, capture } = makeDeps();
    initHandleError(deps, { correlationId: "corr-init-1" });

    handleError(appError("UNKNOWN_CLIENT_ERROR", null));

    expect(capture).toHaveBeenCalledTimes(1);
    expect(ctxOf(capture).correlationId).toBe("corr-init-1");
  });

  it("setErrorUser AFTER init is reflected in the NEXT handleError ctx.user (P2 regression)", () => {
    const { deps, capture } = makeDeps();
    initHandleError(deps, { correlationId: "c" });

    handleError(appError("UNKNOWN_CLIENT_ERROR", null));
    expect(ctxOf(capture).user).toBeNull(); // 로그인 전

    setErrorUser({ id: "u1", role: "admin" }); // 로그인
    handleError(appError("UNKNOWN_CLIENT_ERROR", null));
    expect(ctxOf(capture).user).toEqual({ id: "u1", role: "admin" });

    setErrorUser(null); // 로그아웃
    handleError(appError("UNKNOWN_CLIENT_ERROR", null));
    expect(ctxOf(capture).user).toBeNull();
  });

  it("an explicit opts.ctx.user wins over the singleton user", () => {
    const { deps, capture } = makeDeps();
    initHandleError(deps, { correlationId: "c" });
    setErrorUser({ id: "singleton" });

    handleError(appError("UNKNOWN_CLIENT_ERROR", null), { ctx: { user: { id: "explicit" } } });

    expect(ctxOf(capture).user).toEqual({ id: "explicit" });
  });

  it("returns the DecisionFailure so callers can drive UI off the decision", () => {
    const { deps } = makeDeps();
    initHandleError(deps, { correlationId: "c" });

    const failure = handleError(appError("NOT_FOUND", null));

    expect(failure.ok).toBe(false);
    expect(failure.error.code).toBe("NOT_FOUND");
    expect(failure.decision.user.messageKey).toBe("error.notFound");
  });
});
