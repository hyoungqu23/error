// t-new (G6) — adapters/sonner-presenter.ts
//
// createSonnerPresenter(translator?) returns a Presenter whose present(error, action)
//   (a) resolves COPY via resolveErrorMessage (never the raw userMessageKey),
//   (b) interpolates the {seconds} countdown from RATE_LIMITED.retryAfterMs,
//   (c) dedupes by toast id = error.code,
//   (d) is a no-op for non-Presenter surfaces (only "toast"/"alert" reach toast()).
//
// `sonner` is the ONLY external SDK this adapter touches; we mock it so the test is
// deterministic and asserts exactly what copy/options reach the toast sink. The
// translator + resolveErrorMessage are the REAL modules so we exercise genuine copy.
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the sonner SDK BEFORE importing the adapter (hoisted by vitest).
const toastFn = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => {
  const toast = Object.assign((msg: string, opts?: unknown) => toastFn(msg, opts), {
    error: (msg: string, opts?: unknown) => toastError(msg, opts),
  });
  return { toast };
});

import { createSonnerPresenter } from "@/error/adapters/sonner-presenter";
import { makeError } from "@/error/make-error";
import type { TelemetryContext } from "@/error/telemetry";
import type { Translator } from "@/error/translator";
import { FALLBACK_MESSAGES } from "@/error/translator";

const CTX: TelemetryContext = { runtime: "client", correlationId: "c1", user: null };

beforeEach(() => {
  toastFn.mockClear();
  toastError.mockClear();
});

describe("createSonnerPresenter (G6)", () => {
  it("resolves real copy (not the raw key) and dedupes by toast id = error.code", () => {
    const presenter = createSonnerPresenter();
    const error = makeError({ code: "NETWORK_ERROR", details: null });

    presenter.present(error, "toast", CTX);

    expect(toastFn).toHaveBeenCalledTimes(1);
    const [message, options] = toastFn.mock.calls[0]!;
    // Copy is the resolved fallback line, never the userMessageKey string.
    expect(message).toBe(FALLBACK_MESSAGES.NETWORK_ERROR);
    expect(message).not.toBe(error.userMessageKey);
    expect(message).not.toBe("error.network");
    // Dedupe: id keyed by the error code so a storm collapses into one updating toast.
    expect(options).toEqual({ id: "NETWORK_ERROR" });
  });

  it("repeated presents of the same code reuse the same toast id (dedupe)", () => {
    const presenter = createSonnerPresenter();
    const error = makeError({ code: "OFFLINE", details: null });

    presenter.present(error, "toast", CTX);
    presenter.present(error, "toast", CTX);
    presenter.present(error, "toast", CTX);

    expect(toastFn).toHaveBeenCalledTimes(3);
    for (const call of toastFn.mock.calls) {
      expect(call[1]).toEqual({ id: "OFFLINE" });
    }
  });

  it("interpolates the {seconds} countdown from RATE_LIMITED.retryAfterMs", () => {
    const presenter = createSonnerPresenter();
    // 4500ms → Math.ceil(4500/1000) = 5 seconds.
    const error = makeError({ code: "RATE_LIMITED", details: { retryAfterMs: 4500 } });

    presenter.present(error, "toast", CTX);

    const [message, options] = toastFn.mock.calls[0]!;
    expect(message).toBe("5초 후 다시 시도해주세요.");
    // No raw {seconds} token leaks through.
    expect(message).not.toContain("{seconds}");
    expect(options).toEqual({ id: "RATE_LIMITED" });
  });

  it("'alert' routes to toast.error (still deduped by code)", () => {
    const presenter = createSonnerPresenter();
    const error = makeError({ code: "HTTP_SERVER_ERROR", details: { status: 500 } });

    presenter.present(error, "alert", CTX);

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastFn).not.toHaveBeenCalled();
    const [message, options] = toastError.mock.calls[0]!;
    expect(message).toBe(FALLBACK_MESSAGES.HTTP_SERVER_ERROR);
    expect(options).toEqual({ id: "HTTP_SERVER_ERROR" });
  });

  it("is a no-op for non-Presenter surfaces (inline / redirect / page / silent)", () => {
    const presenter = createSonnerPresenter();
    const error = makeError({ code: "VALIDATION", details: { fieldErrors: {} } });

    for (const surface of ["inline", "redirect", "page", "silent"] as const) {
      presenter.present(error, surface, CTX);
    }

    expect(toastFn).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("prefers an injected translator's copy when it resolves the key", () => {
    const translator: Translator = {
      locale: "en",
      t: (key, vars) =>
        key === "error.rateLimited" ? `Retry in ${String(vars?.seconds)}s` : key,
    };
    const presenter = createSonnerPresenter(translator);
    const error = makeError({ code: "RATE_LIMITED", details: { retryAfterMs: 2000 } });

    presenter.present(error, "toast", CTX);

    const [message] = toastFn.mock.calls[0]!;
    // Host translator wins AND receives the interpolation vars (seconds = ceil(2000/1000)).
    expect(message).toBe("Retry in 2s");
  });
});
