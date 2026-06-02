import { describe, it, expect } from "vitest";
import { retryAfterHintFromError, parseRetryAfter } from "../retry-after";
import { appError } from "../decision/app-error";

describe("retryAfterHintFromError (P3b-i)", () => {
  it("reads top-level retryAfterMs from a new AppError (D5 single source)", () => {
    expect(retryAfterHintFromError(appError("RATE_LIMITED", null, { retryAfterMs: 5000 }))).toBe(5000);
  });
  it("falls back to details.retryAfterMs (legacy shape)", () => {
    expect(retryAfterHintFromError(appError("RATE_LIMITED", { retryAfterMs: 3000 }))).toBe(3000);
  });
  it("returns undefined for non-AppError or missing hint", () => {
    expect(retryAfterHintFromError(new Error("x"))).toBeUndefined();
    expect(retryAfterHintFromError(appError("TIMEOUT"))).toBeUndefined();
  });
});
describe("parseRetryAfter unchanged", () => {
  it("delta-seconds", () => { expect(parseRetryAfter("120")).toBe(120000); });
});
