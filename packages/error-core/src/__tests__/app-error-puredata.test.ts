import { describe, it, expect } from "vitest";
import { AppError, appError, isAppError } from "../decision/app-error";
import type { DecisionError } from "../decision/resolve";

describe("AppError (pure data)", () => {
  it("appError() constructs a pure-data AppError with no policy getters", () => {
    const e = appError("VALIDATION", { fieldErrors: { email: ["bad"] } }, { correlationId: "r1", retryAfterMs: 1000 });
    expect(e).toBeInstanceOf(AppError);
    expect(e.code).toBe("VALIDATION");
    expect((e.details as any).fieldErrors.email).toEqual(["bad"]);
    expect(e.correlationId).toBe("r1");
    expect(e.retryAfterMs).toBe(1000);
    expect(e.name).toBe("AppError");
    // NO policy getters exist on the instance:
    expect((e as any).severity).toBeUndefined();
    expect((e as any).present).toBeUndefined();
    expect((e as any).httpStatus).toBeUndefined();
    expect(typeof (e as any).resolve).not.toBe("function");
  });

  it("structurally satisfies DecisionError", () => {
    const e = appError("TIMEOUT", null, { retryAfterMs: 500, userCanRetry: true });
    const d: DecisionError = e; // compile-time structural check
    expect(d.code).toBe("TIMEOUT");
    expect(d.retryAfterMs).toBe(500);
  });

  it("isAppError matches instances and duck-types (cross-realm)", () => {
    expect(isAppError(appError("NOT_FOUND"))).toBe(true);
    expect(isAppError({ name: "AppError", code: "X" })).toBe(true); // duck-type
    expect(isAppError({ name: "DomainError", code: "X" })).toBe(true); // legacy duck-type
    expect(isAppError(new Error("x"))).toBe(false);
    expect(isAppError(null)).toBe(false);
  });

  it("toSerialized round-trips through fromSerialized preserving correlationId/digest", () => {
    const e = appError("RATE_LIMITED", { retryAfterMs: 2000 }, { correlationId: "c", digest: "dg", retryAfterMs: 2000 });
    const wire = e.toSerialized();
    const back = AppError.fromSerialized(wire);
    expect(back).toBeInstanceOf(AppError);
    expect(back.code).toBe("RATE_LIMITED");
    expect(back.correlationId).toBe("c");
    expect(back.digest).toBe("dg");
    expect(back.retryAfterMs).toBe(2000);
  });
});
