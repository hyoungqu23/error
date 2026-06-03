// §10 — makeError validation & runtime-driven UNKNOWN_* fallback.
// @/error/runtime을 목해 getRuntime()을 결정적으로 만든다: makeError의 unknownCodeForRuntime()이
// 이 단일 목을 통해 라우팅된다. (P3e: 상세 검증은 catalog validateDetails로 이동; 구 zod schema 제거.)
import { describe, it, expect, vi, beforeEach } from "vitest";

import { makeError } from "@/error/make-error";
import { isAppError } from "@/error/decision/app-error";

// Hoisted holder so the factory can read a value we flip per-test.
const runtimeState = vi.hoisted(() => ({ value: "server" as "server" | "client" }));

vi.mock("@/error/runtime", () => ({
  getRuntime: () => runtimeState.value,
}));

beforeEach(() => {
  // Default the env to "server" before each test; mutate explicitly when needed.
  runtimeState.value = "server";
});

describe("makeError — §10 validation", () => {
  it("valid details pass through and set code + details (round-trip equal)", () => {
    const details = { fieldErrors: { email: ["required"] } };
    const err = makeError({ code: "VALIDATION", details });

    expect(isAppError(err)).toBe(true);
    expect(err.code).toBe("VALIDATION");
    // parsed.data is structurally equal to the supplied object.
    expect(err.details).toEqual(details);
  });

  it("accepts a code whose schema is z.null() with null details", () => {
    const err = makeError({ code: "AUTH_REQUIRED", details: null });

    expect(err.code).toBe("AUTH_REQUIRED");
    expect(err.details).toBeNull();
  });

  it("invalid details → UNKNOWN_SERVER_ERROR when runtime is server", () => {
    runtimeState.value = "server";
    // VALIDATION requires { fieldErrors }, so a bare string fails the schema.
    const err = makeError({
      code: "VALIDATION",
      details: "not-a-valid-shape" as never,
    });

    expect(err.code).toBe("UNKNOWN_SERVER_ERROR");
    // Fallback details are normalized to null (appError(unknownCodeForRuntime(), null, …)).
    expect(err.details).toBeNull();
  });

  it("invalid details → UNKNOWN_CLIENT_ERROR when runtime is client", () => {
    runtimeState.value = "client";
    const err = makeError({
      code: "VALIDATION",
      details: "not-a-valid-shape" as never,
    });

    expect(err.code).toBe("UNKNOWN_CLIENT_ERROR");
    expect(err.details).toBeNull();
  });

  it("the chosen fallback code differs by runtime for the same bad input", () => {
    const bad = { code: "VALIDATION", details: 123 as never } as const;

    runtimeState.value = "server";
    const serverErr = makeError({ ...bad });

    runtimeState.value = "client";
    const clientErr = makeError({ ...bad });

    expect(serverErr.code).toBe("UNKNOWN_SERVER_ERROR");
    expect(clientErr.code).toBe("UNKNOWN_CLIENT_ERROR");
    expect(serverErr.code).not.toBe(clientErr.code);
  });

  it("reaching the fallback does not throw", () => {
    expect(() =>
      makeError({ code: "VALIDATION", details: undefined as never }),
    ).not.toThrow();
  });

  it("threads correlationId, custom message, and cause on the SUCCESS path", () => {
    const cause = new Error("upstream");
    const err = makeError({
      code: "NOT_FOUND",
      details: { resource: "user" },
      message: "missing user",
      cause,
      correlationId: "corr-success-1",
    });

    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).toBe("missing user");
    expect(err.cause).toBe(cause);
    expect(err.correlationId).toBe("corr-success-1");
  });

  it("threads correlationId + custom message and keeps the explicit cause on the FALLBACK path", () => {
    runtimeState.value = "server";
    const cause = new Error("explicit cause");
    const err = makeError({
      code: "VALIDATION",
      details: { wrong: true } as never,
      message: "custom fallback message",
      cause,
      correlationId: "corr-fallback-1",
    });

    expect(err.code).toBe("UNKNOWN_SERVER_ERROR");
    expect(err.message).toBe("custom fallback message");
    // Explicit cause wins over the `?? opts.details` branch.
    expect(err.cause).toBe(cause);
    expect(err.correlationId).toBe("corr-fallback-1");
  });

  it("on the FALLBACK path with no explicit cause, the bad details become the cause", () => {
    runtimeState.value = "client";
    const badDetails = { whoops: "bad" };
    const err = makeError({
      code: "VALIDATION",
      details: badDetails as never,
    });

    expect(err.code).toBe("UNKNOWN_CLIENT_ERROR");
    // cause falls back to opts.details when opts.cause is absent.
    expect(err.cause).toBe(badDetails);
    // No custom message → the default Korean fallback message is used.
    expect(err.message).toBe("알 수 없는 오류가 발생했습니다.");
  });
});
