// @vitest-environment jsdom
//
// t-new (G11) — ErrorFallback affordance + accessibility + resilience.
//   (a) focuses the role="alert" container on mount,
//   (c) reset-only retry calls router.refresh() THEN reset() (Next 15 RSC refetch),
//   (d) hides the retry button for a non-retryable DomainError code,
//   (e) the handleError effect is wrapped in try/catch so global-error.tsx never
//       throws when the client singleton is uninitialized.
//
// This file deliberately does NOT mock "@/error/handler" (unlike error-fallback.test.tsx)
// so we can drive the singleton-uninitialized branch with the REAL throwing handler.
// next/navigation is irrelevant here: ErrorFallback reads AppRouterContext directly,
// so we provide a mock router through that context instead.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactElement } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

import { ErrorFallback } from "@/components/ErrorFallback";
import { makeError } from "@/error/make-error";
import { setActiveErrorRegistry } from "@/error/active-registry";
import { DEFAULT_ERROR_REGISTRY } from "@/error/registry";

// Bind the active registry on the client (jsdom → runtime "client") so a DomainError's
// `retryable` getter resolves off DEFAULT deterministically.
setActiveErrorRegistry(DEFAULT_ERROR_REGISTRY);

const mockRouter = (refresh: () => void): AppRouterInstance =>
  ({
    refresh,
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }) as unknown as AppRouterInstance;

const renderWithRouter = (ui: ReactElement, refresh = vi.fn()) =>
  render(<AppRouterContext.Provider value={mockRouter(refresh)}>{ui}</AppRouterContext.Provider>);

const plainErr = (): Error & { digest?: string } => Object.assign(new Error("x"), {});

beforeEach(() => {
  vi.stubGlobal("location", { ...window.location, pathname: "/now", search: "", reload: vi.fn() });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ErrorFallback (G11)", () => {
  it("(a) focuses the role='alert' container on mount", () => {
    renderWithRouter(<ErrorFallback error={plainErr()} reset={vi.fn()} />);
    const alert = screen.getByRole("alert");
    expect(document.activeElement).toBe(alert);
    // tabIndex={-1} makes the non-interactive container programmatically focusable.
    expect(alert.getAttribute("tabindex")).toBe("-1");
  });

  it("(c) reset-only retry calls router.refresh() then reset() (RSC refetch on Next 15)", () => {
    const order: string[] = [];
    const refresh = vi.fn(() => order.push("refresh"));
    const reset = vi.fn(() => order.push("reset"));

    renderWithRouter(<ErrorFallback error={plainErr()} reset={reset} />, refresh);
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["refresh", "reset"]); // refresh BEFORE reset
  });

  it("(c) prefers unstable_retry and does NOT call router.refresh/reset", () => {
    const refresh = vi.fn();
    const reset = vi.fn();
    const unstable_retry = vi.fn();

    renderWithRouter(
      <ErrorFallback error={plainErr()} unstable_retry={unstable_retry} reset={reset} />,
      refresh,
    );
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

    expect(unstable_retry).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
  });

  it("(d) hides the retry affordance for a non-retryable DomainError code", () => {
    // VALIDATION → retryable:false in the registry → no retry button.
    const error = makeError({ code: "VALIDATION", details: { fieldErrors: {} } });
    renderWithRouter(<ErrorFallback error={error} reset={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "다시 시도" })).toBeNull();
  });

  it("(d) shows the retry affordance for a retryable DomainError code", () => {
    // HTTP_SERVER_ERROR → retryable:true → retry button rendered.
    const error = makeError({ code: "HTTP_SERVER_ERROR", details: { status: 500 } });
    renderWithRouter(<ErrorFallback error={error} reset={vi.fn()} />);

    expect(screen.getByRole("button", { name: "다시 시도" })).toBeTruthy();
  });

  it("(e) never throws on mount when the handleError singleton is uninitialized", () => {
    // The real "@/error/handler" is NOT mocked here, so handleError() throws
    // ("initHandleError() not called"). The effect must swallow it and still render copy.
    expect(() =>
      renderWithRouter(<ErrorFallback error={plainErr()} reset={vi.fn()} minimal />),
    ).not.toThrow();

    // Real copy still renders (resolveErrorMessage never returns the raw key / throws).
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("알 수 없는 오류가 발생했습니다.");
  });

  it("(b) the retry button reflects the transition (disabled prop wired)", () => {
    // The button carries a `disabled` attribute driven by useTransition's isPending.
    // Idle render → not disabled (smoke check that the affordance is interactive).
    renderWithRouter(<ErrorFallback error={plainErr()} reset={vi.fn()} />);
    const button = screen.getByRole("button", { name: "다시 시도" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });
});
