// @vitest-environment jsdom
// §8.2 — useErrorHandler 라우팅/에스컬레이션 특성화 (P2 리뷰 보강: 이전까지 테스트 0).
// 보안-관련 분기 5종을 핀한다: redirect surface, action==="login"(비-redirect surface에서도
// 카탈로그 의도 보존 — P8 결정), page+매핑 라우트, page+미매핑(throw 에스컬레이션), 패스스루.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const handleError = vi.fn();
vi.mock("@/error/handler", () => ({
  handleError: (input: unknown, opts?: unknown) => handleError(input, opts),
}));

import { useErrorHandler } from "@/error/use-error-handler";

type FailureShape = {
  ok: false;
  error: { code: string };
  decision: { user: { surface: string; action: string; target?: string } };
};

const failure = (
  surface: string,
  action: string,
  code = "UNKNOWN_CLIENT_ERROR",
  target?: string,
): FailureShape => ({
  ok: false,
  error: { code },
  decision: { user: { surface, action, ...(target !== undefined ? { target } : {}) } },
});

beforeEach(() => {
  push.mockClear();
  handleError.mockClear();
  vi.stubGlobal("location", { ...window.location, pathname: "/checkout", search: "?step=2" });
});

describe("useErrorHandler (§8.2 routing)", () => {
  it("surface 'redirect' pushes the decision target with returnTo", () => {
    handleError.mockReturnValue(failure("redirect", "login", "AUTH_REQUIRED", "/login"));
    const { result } = renderHook(() => useErrorHandler());

    result.current(new Error("x"));

    expect(push).toHaveBeenCalledWith(
      "/login?returnTo=" + encodeURIComponent("/checkout?step=2"),
    );
  });

  it("action 'login' on a NON-redirect surface still redirects (catalog intent preserved)", () => {
    handleError.mockReturnValue(failure("inline", "login", "AUTH_REQUIRED"));
    const { result } = renderHook(() => useErrorHandler());

    result.current(new Error("x"));

    expect(push).toHaveBeenCalledTimes(1);
    expect(String(push.mock.calls[0]![0])).toContain("/login?returnTo=");
  });

  it("surface 'page' with a mapped code navigates to the dedicated route", () => {
    handleError.mockReturnValue(failure("page", "request-access", "FORBIDDEN"));
    const { result } = renderHook(() => useErrorHandler());

    result.current(new Error("x"));

    expect(push).toHaveBeenCalledWith("/403");
  });

  it("surface 'page' without a mapped route THROWS the normalized error (error.tsx escalation)", () => {
    const f = failure("page", "contact-support", "UNKNOWN_CLIENT_ERROR");
    handleError.mockReturnValue(f);
    const { result } = renderHook(() => useErrorHandler());

    expect(() => result.current(new Error("x"))).toThrow();
    expect(push).not.toHaveBeenCalled();
  });

  it("in-place surfaces (toast/inline) just return the failure — caller drives the UI", () => {
    const f = failure("toast", "retry", "NETWORK_ERROR");
    handleError.mockReturnValue(f);
    const { result } = renderHook(() => useErrorHandler());

    const returned = result.current(new Error("x"));

    expect(returned).toBe(f);
    expect(push).not.toHaveBeenCalled();
  });
});

// §8.2 — 이벤트-핸들러 안전 기본값 계약(P8 후속 결함 제거).
// 함정: handler.ts FALLBACK_OCCURRENCE.uiScope="page" → resolve가 거의 모든 코드를 surface:"page"로
// 올리고 → 이 훅이 PAGE_ROUTE 미매핑 코드를 throw → 이벤트 핸들러 동기 throw는 error.tsx로
// 라우팅되지 않아 UI 없는 미처리 예외가 됐다. 훅 레벨에서 미명시 uiScope를 "component"로 기본
// 주입해 throw 경로를 끊는다. 아래 surface 리터럴은 resolve.ts 실측값(decision-resolve.test.ts와
// 동일한 canonical 카탈로그)을 핀한 것이다 — 추측 아님:
//   component+event-handler: VALIDATION→inline, TIMEOUT→toast, FORBIDDEN→inline(request-access),
//   AUTH_REQUIRED→inline(login), UNKNOWN_CLIENT_ERROR→inline.
describe("useErrorHandler (§8.2 event-handler-safe default uiScope)", () => {
  it("미명시 호출은 handleError에 occurrence.uiScope='component'를 기본 주입한다", () => {
    handleError.mockReturnValue(failure("inline", "fix-input", "VALIDATION"));
    const { result } = renderHook(() => useErrorHandler());

    result.current(new Error("x"));

    const opts = handleError.mock.calls[0]![1] as { occurrence?: { uiScope?: string } };
    expect(opts?.occurrence?.uiScope).toBe("component");
  });

  it("기본 uiScope 주입이 다른 opts(telemetry)·occurrence 키(interaction)를 보존한다 (스프레드 보존, testing INFO)", () => {
    // uiScope만 'component'로 주입되고 telemetry·occurrence.interaction은 그대로 handleError로 전달돼야 한다.
    handleError.mockReturnValue(failure("inline", "fix-input", "VALIDATION"));
    const { result } = renderHook(() => useErrorHandler());

    result.current(new Error("x"), { telemetry: { capture: false }, occurrence: { interaction: "query" } });

    const opts = handleError.mock.calls[0]![1] as {
      telemetry?: { capture?: boolean };
      occurrence?: { uiScope?: string; interaction?: string };
    };
    expect(opts?.telemetry?.capture).toBe(false); // telemetry 보존
    expect(opts?.occurrence?.interaction).toBe("query"); // 기존 occurrence 키 보존
    expect(opts?.occurrence?.uiScope).toBe("component"); // uiScope만 기본 주입
  });

  it("미명시 + PAGE_ROUTE 미매핑 코드(VALIDATION/inline)는 throw하지 않고 component-surface 결과를 반환", () => {
    // 기본값이 component → resolve가 inline을 고르므로 page 에스컬레이션(throw) 경로를 타지 않는다.
    const f = failure("inline", "fix-input", "VALIDATION");
    handleError.mockReturnValue(f);
    const { result } = renderHook(() => useErrorHandler());

    let returned: unknown;
    expect(() => {
      returned = result.current(new Error("x"));
    }).not.toThrow();
    expect(returned).toBe(f);
    expect(push).not.toHaveBeenCalled();
  });

  it("미명시 + 미매핑 코드(TIMEOUT/toast)도 throw하지 않고 반환", () => {
    const f = failure("toast", "retry", "TIMEOUT");
    handleError.mockReturnValue(f);
    const { result } = renderHook(() => useErrorHandler());

    let returned: unknown;
    expect(() => {
      returned = result.current(new Error("x"));
    }).not.toThrow();
    expect(returned).toBe(f);
    expect(push).not.toHaveBeenCalled();
  });

  it("호출자가 명시한 occurrence.uiScope는 덮어쓰지 않는다 (명시값 'session' 그대로 전달)", () => {
    handleError.mockReturnValue(failure("page", "retry", "UNKNOWN_CLIENT_ERROR"));
    const { result } = renderHook(() => useErrorHandler());

    expect(() => result.current(new Error("x"), { occurrence: { uiScope: "session" } })).toThrow();
    const opts = handleError.mock.calls[0]![1] as { occurrence?: { uiScope?: string } };
    expect(opts?.occurrence?.uiScope).toBe("session");
  });

  it("명시적 uiScope='page' + 미매핑 코드 → 기존대로 throw (render 경로 escalation 계약 유지)", () => {
    // 명시적 page는 보존되어 resolve가 surface:"page"를 고른다(decision-resolve 실측: 모든 코드 page).
    handleError.mockReturnValue(failure("page", "retry", "UNKNOWN_CLIENT_ERROR"));
    const { result } = renderHook(() => useErrorHandler());

    expect(() => result.current(new Error("x"), { occurrence: { uiScope: "page" } })).toThrow();
    const opts = handleError.mock.calls[0]![1] as { occurrence?: { uiScope?: string } };
    expect(opts?.occurrence?.uiScope).toBe("page"); // 기본값으로 덮이지 않음
    expect(push).not.toHaveBeenCalled();
  });

  it("AUTH_REQUIRED 기본값(component→inline·action 'login')은 surface와 독립적으로 로그인 내비게이션을 보존", () => {
    // 변경 전(uiScope:page→surface:page)에도 action==="login" 분기가 router.push를 했고, 변경 후
    // (component→inline)에도 같은 분기가 살아 동일하게 리다이렉트한다 — 내비게이션 동작 불변.
    handleError.mockReturnValue(failure("inline", "login", "AUTH_REQUIRED"));
    const { result } = renderHook(() => useErrorHandler());

    expect(() => result.current(new Error("x"))).not.toThrow();
    expect(push).toHaveBeenCalledTimes(1);
    expect(String(push.mock.calls[0]![0])).toContain("/login?returnTo=");
  });

  it("FORBIDDEN 기본값(component→inline·request-access)은 /403로 자동 내비게이션하지 않는다 (변경 후 동작)", () => {
    // 변경 전: uiScope:page→surface:page→PAGE_ROUTE_BY_CODE[FORBIDDEN]=/403 push.
    // 변경 후: 기본 component→surface:inline→내비게이션 없이 failure 반환(호출자가 inline UI를 그린다).
    // /403 전용 라우트가 필요하면 호출자가 occurrence.uiScope='page'를 명시한다(아래 테스트로 보존 확인).
    const f = failure("inline", "request-access", "FORBIDDEN");
    handleError.mockReturnValue(f);
    const { result } = renderHook(() => useErrorHandler());

    const returned = result.current(new Error("x"));

    expect(returned).toBe(f);
    expect(push).not.toHaveBeenCalled();
  });

  it("FORBIDDEN을 명시적 uiScope='page'로 올리면 기존 /403 전용 라우트 내비게이션은 그대로 동작", () => {
    handleError.mockReturnValue(failure("page", "request-access", "FORBIDDEN"));
    const { result } = renderHook(() => useErrorHandler());

    result.current(new Error("x"), { occurrence: { uiScope: "page" } });

    expect(push).toHaveBeenCalledWith("/403");
  });
});
