// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

// §10 — boundary component (ErrorFallback). The handler sink is the real seam to
// the error pipeline; we mock it so the effect's call is observable AND so the test
// never touches the active registry / reporter / notifier. resolveErrorMessage is
// the REAL module (provider-free, never throws, never returns the raw key), so the
// rendered title is genuine copy.
const handleError = vi.fn((_input: unknown, _opts?: unknown) => ({}) as never);
vi.mock("@/error/handler", () => ({
  handleError: (input: unknown, opts?: unknown) => handleError(input, opts),
}));

import { ErrorFallback } from "@/components/ErrorFallback";

const makeErr = (digest?: string): Error & { digest?: string } =>
  Object.assign(new Error("x"), digest === undefined ? {} : { digest });

beforeEach(() => {
  handleError.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("ErrorFallback (§10 boundary component)", () => {
  it("reports to handleError exactly once in the effect with log:'none' (no duplicate server report)", async () => {
    const error = makeErr("d1");
    render(<ErrorFallback error={error} reset={vi.fn()} />);

    await waitFor(() => expect(handleError).toHaveBeenCalledTimes(1));

    const call = handleError.mock.calls[0];
    expect(call).toBeDefined();
    // First positional arg is the error itself.
    expect(call?.[0]).toBe(error);
    // Second arg carries the log:"none" guard (already reported upstream) and a ctx.
    const opts = call?.[1] as { log?: string; ctx?: { route?: string } } | undefined;
    expect(opts).toMatchObject({ log: "none" });
    // route is folded into TelemetryContext via ctx (location.pathname in jsdom).
    expect(opts?.ctx).toMatchObject({ route: expect.any(String) });
  });

  it("shows the digest as a support ref", () => {
    render(<ErrorFallback error={makeErr("d1")} reset={vi.fn()} />);
    expect(screen.getByText(/ref:\s*d1/)).toBeTruthy();
  });

  it("omits the support ref when there is no digest", () => {
    render(<ErrorFallback error={makeErr(undefined)} reset={vi.fn()} />);
    expect(screen.queryByText(/^ref:/)).toBeNull();
  });

  it("renders a 다시 시도 retry button whose click invokes reset", () => {
    const reset = vi.fn();
    render(<ErrorFallback error={makeErr("d1")} reset={reset} />);

    const button = screen.getByRole("button", { name: "다시 시도" });
    fireEvent.click(button);
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("prefers unstable_retry over reset for the retry button", () => {
    const unstable_retry = vi.fn();
    const reset = vi.fn();
    render(
      <ErrorFallback
        error={makeErr("d1")}
        unstable_retry={unstable_retry}
        reset={reset}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(unstable_retry).toHaveBeenCalledTimes(1);
    expect(reset).not.toHaveBeenCalled();
  });

  it("falls back to location.reload when neither retry handler is provided", () => {
    const reload = vi.fn();
    // jsdom's location.reload is not implemented; stub it.
    vi.stubGlobal("location", { ...window.location, pathname: "/", reload });
    try {
      render(<ErrorFallback error={makeErr("d1")} />);
      fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("renders real localized copy (never the raw key) via the alert region", () => {
    render(<ErrorFallback error={makeErr("d1")} reset={vi.fn()} />);
    const alert = screen.getByRole("alert");
    // resolveErrorMessage("error.unknown") for a non-DomainError → generic Korean line.
    expect(alert.textContent).toContain("알 수 없는 오류가 발생했습니다.");
  });
});
