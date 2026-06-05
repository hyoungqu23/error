// t-new (G6) — adapters/sonner-presenter.ts (P6: 신 Presenter 계약)
//
// createSonnerPresenter(translator?) returns a Presenter whose present(error, user, ctx)
//   (a) resolves COPY via resolveErrorMessage from user.messageKey (never the raw key),
//   (b) interpolates the {seconds} countdown — user.messageVars 우선, 없으면
//       retryAfterMs(user.retryAfterMs ?? error 힌트)에서 도출 (G2/G6),
//   (c) dedupes by toast id = error.code,
//   (d) is a no-op for non-presenter surfaces (only "toast"/"dialog" reach toast()).
//
// `sonner` is the ONLY external SDK this adapter touches; we mock it so the test is
// deterministic. The translator + resolveErrorMessage are the REAL modules.
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
import type { TelemetryContext, UserErrorDecision } from "@/error/index";
import type { Translator } from "@/error/translator";
import { FALLBACK_MESSAGES } from "@/error/translator";

const CTX: TelemetryContext = {
  runtime: "client",
  operation: "checkout",
  correlationId: "c1",
  user: null,
};

/** UserErrorDecision 리터럴 헬퍼 — 필수 필드만 받고 나머지는 기본값. */
const userDecision = (
  overrides: Partial<UserErrorDecision> & Pick<UserErrorDecision, "surface" | "messageKey">,
): UserErrorDecision => ({
  disclosure: "specific",
  action: "retry",
  ...overrides,
});

beforeEach(() => {
  toastFn.mockClear();
  toastError.mockClear();
});

describe("createSonnerPresenter (G6, P6 Presenter)", () => {
  it("resolves real copy from user.messageKey (not the raw key) and dedupes by error.code", () => {
    const presenter = createSonnerPresenter();
    const error = makeError({ code: "NETWORK_ERROR", details: null });

    presenter.present(error, userDecision({ surface: "toast", messageKey: "error.network" }), CTX);

    expect(toastFn).toHaveBeenCalledTimes(1);
    const [message, options] = toastFn.mock.calls[0]!;
    expect(message).toBe(FALLBACK_MESSAGES.NETWORK_ERROR);
    expect(message).not.toBe("error.network");
    expect(options).toEqual({ id: "NETWORK_ERROR" });
  });

  it("repeated presents of the same code reuse the same toast id (dedupe)", () => {
    const presenter = createSonnerPresenter();
    const error = makeError({ code: "OFFLINE", details: null });
    const user = userDecision({ surface: "toast", messageKey: "error.offline" });

    presenter.present(error, user, CTX);
    presenter.present(error, user, CTX);
    presenter.present(error, user, CTX);

    expect(toastFn).toHaveBeenCalledTimes(3);
    for (const call of toastFn.mock.calls) {
      expect(call[1]).toEqual({ id: "OFFLINE" });
    }
  });

  it("interpolates {seconds} from user.retryAfterMs (the resolved decision wins)", () => {
    const presenter = createSonnerPresenter();
    // 4500ms → Math.ceil(4500/1000) = 5 seconds.
    const error = makeError({ code: "RATE_LIMITED", details: { retryAfterMs: 4500 } });

    presenter.present(
      error,
      userDecision({ surface: "toast", messageKey: "error.rateLimited", retryAfterMs: 4500 }),
      CTX,
    );

    const [message, options] = toastFn.mock.calls[0]!;
    expect(message).toBe("5초 후 다시 시도해주세요.");
    expect(message).not.toContain("{seconds}");
    expect(options).toEqual({ id: "RATE_LIMITED" });
  });

  it("falls back to the error's retryAfterMs hint when the decision carries none", () => {
    const presenter = createSonnerPresenter();
    const error = makeError({ code: "RATE_LIMITED", details: { retryAfterMs: 2000 } });

    presenter.present(
      error,
      userDecision({ surface: "toast", messageKey: "error.rateLimited" }),
      CTX,
    );

    const [message] = toastFn.mock.calls[0]!;
    expect(message).toBe("2초 후 다시 시도해주세요.");
  });

  it("prefers explicit user.messageVars over any retryAfterMs derivation (§5.4 forward-compat)", () => {
    const presenter = createSonnerPresenter();
    const error = makeError({ code: "RATE_LIMITED", details: { retryAfterMs: 9000 } });

    presenter.present(
      error,
      userDecision({
        surface: "toast",
        messageKey: "error.rateLimited",
        messageVars: { seconds: 7 },
        retryAfterMs: 9000,
      }),
      CTX,
    );

    const [message] = toastFn.mock.calls[0]!;
    expect(message).toBe("7초 후 다시 시도해주세요.");
  });

  it("'dialog' routes to toast.error (still deduped by code) — 구 'alert'의 신 어휘", () => {
    const presenter = createSonnerPresenter();
    const error = makeError({ code: "HTTP_SERVER_ERROR", details: { status: 500 } });

    presenter.present(
      error,
      userDecision({ surface: "dialog", messageKey: "error.httpServer" }),
      CTX,
    );

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastFn).not.toHaveBeenCalled();
    const [message, options] = toastError.mock.calls[0]!;
    expect(message).toBe(FALLBACK_MESSAGES.HTTP_SERVER_ERROR);
    expect(options).toEqual({ id: "HTTP_SERVER_ERROR" });
  });

  it("is a no-op for non-presenter surfaces (field/form/inline/empty/page/redirect/silent)", () => {
    const presenter = createSonnerPresenter();
    const error = makeError({ code: "VALIDATION", details: { fieldErrors: {} } });

    for (const surface of [
      "field",
      "form",
      "inline",
      "empty",
      "page",
      "redirect",
      "silent",
    ] as const) {
      presenter.present(error, userDecision({ surface, messageKey: "error.validation" }), CTX);
    }

    expect(toastFn).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("prefers an injected translator's copy when it resolves the key (vars forwarded)", () => {
    const translator: Translator = {
      locale: "en",
      t: (key, vars) =>
        key === "error.rateLimited" ? `Retry in ${String(vars?.seconds)}s` : key,
    };
    const presenter = createSonnerPresenter(translator);
    const error = makeError({ code: "RATE_LIMITED", details: { retryAfterMs: 2000 } });

    presenter.present(
      error,
      userDecision({ surface: "toast", messageKey: "error.rateLimited" }),
      CTX,
    );

    const [message] = toastFn.mock.calls[0]!;
    // Host translator wins AND receives the interpolation vars (seconds = ceil(2000/1000)).
    expect(message).toBe("Retry in 2s");
  });
});
