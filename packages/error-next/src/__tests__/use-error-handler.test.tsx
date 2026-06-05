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
