// §10 serialization — LEAK-PREVENTION enforcement point (toClientSerialized).
// Asserts: free-text message is dropped, code/userMessageKey/correlationId kept,
// details gated by DETAILS_ALLOWLIST, and the DTO is JSON-safe (no class/funcs).
import { describe, it, expect } from "vitest";
import {
  toClientSerialized,
  gateClientDetails,
  DETAILS_ALLOWLIST,
  type ClientSerializedError,
} from "@/error/serialize-client";
import { construct, DomainError } from "@/error/app-error";
import { getRuntime } from "@/error/runtime";
import { ErrorDetailsSchema } from "@/error/schema";
import type { ErrorCode } from "@/error/registry";

// P3b-ii: serialize-client + toClientSerialized read the OLD DomainError policy getters
// (userMessageKey/httpStatus) and stay on the old stack until P3c. The production `makeError`
// now returns an AppError, so this old-stack test keeps a local DomainError-producing shim
// (the pre-P3b-ii makeError: zod-validate, else UNKNOWN_* fallback).
const makeError = (opts: {
  code: ErrorCode;
  details?: unknown;
  message?: string;
  cause?: unknown;
  correlationId?: string;
  digest?: string;
}): DomainError => {
  const parsed = ErrorDetailsSchema[opts.code].safeParse(opts.details);
  if (!parsed.success) {
    const fallback = getRuntime() === "server" ? "UNKNOWN_SERVER_ERROR" : "UNKNOWN_CLIENT_ERROR";
    return construct(fallback, null, {
      message: opts.message ?? "알 수 없는 오류가 발생했습니다.",
      cause: opts.cause ?? opts.details,
      correlationId: opts.correlationId,
      digest: opts.digest,
    });
  }
  return construct(opts.code, parsed.data, {
    message: opts.message,
    cause: opts.cause,
    correlationId: opts.correlationId,
    digest: opts.digest,
  });
};

// Deep round-trip helper: a value is JSON-safe iff parse(stringify(x)) deep-equals x.
const jsonRoundTrips = (x: unknown): boolean => {
  const round = JSON.parse(JSON.stringify(x));
  expect(round).toEqual(x);
  return true;
};

// Assert no function lives anywhere in the structure (would silently vanish over JSON).
const hasNoFunctions = (x: unknown): boolean => {
  if (typeof x === "function") return false;
  if (x === null || typeof x !== "object") return true;
  return Object.values(x as Record<string, unknown>).every(hasNoFunctions);
};

describe("toClientSerialized (§10 leak prevention)", () => {
  it("DROPS the free-text message — no raw server message leaks to the client DTO", () => {
    const secret = "DB connection refused at 10.0.0.7: password=hunter2";
    const err = makeError({
      code: "HTTP_SERVER_ERROR",
      details: { status: 500 },
      message: secret,
    });

    const dto = toClientSerialized(err);

    // No `message` field whatsoever on the client DTO.
    expect("message" in dto).toBe(false);
    expect((dto as unknown as Record<string, unknown>).message).toBeUndefined();
    // The secret string must not appear anywhere in the serialized payload.
    expect(JSON.stringify(dto)).not.toContain("hunter2");
    expect(JSON.stringify(dto)).not.toContain("10.0.0.7");
  });

  it("keeps code + userMessageKey + correlationId", () => {
    const err = makeError({
      code: "VALIDATION",
      details: { fieldErrors: { email: ["required"] } },
      correlationId: "corr-123",
    });

    const dto = toClientSerialized(err);

    expect(dto.code).toBe("VALIDATION");
    // userMessageKey is read off the active registry (DEFAULT) for VALIDATION.
    expect(dto.userMessageKey).toBe("error.validation");
    expect(dto.userMessageKey).toBe(err.userMessageKey);
    expect(dto.correlationId).toBe("corr-123");
  });

  it("when correlationId is absent it serializes to undefined and JSON drops it", () => {
    const err = makeError({
      code: "VALIDATION",
      details: { fieldErrors: { name: ["too short"] } },
    });

    const dto = toClientSerialized(err);

    // correlationId is assigned unconditionally from the (undefined) instance value,
    // so the key exists but holds undefined...
    expect(dto.correlationId).toBeUndefined();
    // ...and JSON.stringify drops undefined values, so the wire payload is clean.
    const wire = JSON.parse(JSON.stringify(dto));
    expect("correlationId" in wire).toBe(false);
    expect(wire).toEqual({ code: "VALIDATION", userMessageKey: "error.validation", details: { fieldErrors: { name: ["too short"] } } });
  });

  it("threads digest only when provided", () => {
    const err = makeError({ code: "AUTH_REQUIRED", details: null });

    const withDigest = toClientSerialized(err, "dig-abc");
    expect(withDigest.digest).toBe("dig-abc");

    const without = toClientSerialized(err);
    expect("digest" in without).toBe(false);
  });

  it("VALIDATION.fieldErrors is PRESERVED by the allowlist", () => {
    const fieldErrors = { email: ["invalid"], age: ["must be >= 18"] };
    const err = makeError({ code: "VALIDATION", details: { fieldErrors } });

    const dto = toClientSerialized(err);

    expect(dto.details).toBeDefined();
    expect(dto.details).toEqual({ fieldErrors });
  });

  it("shallow-picks ONLY allowlisted keys — non-allowlisted sibling keys are dropped", () => {
    // Hand-build a DomainError whose details carry an extra (non-allowlisted) key
    // alongside the allowlisted fieldErrors, to prove the picker drops siblings.
    // (makeError's schema would reject the extra key, so construct directly here —
    //  we are testing the GATE, not the schema.)
    const err = new DomainError({
      code: "VALIDATION",
      details: {
        fieldErrors: { email: ["required"] },
        // not in DETAILS_ALLOWLIST.VALIDATION — must be stripped:
        internalQuery: "SELECT * FROM users WHERE secret=1",
      } as never,
    });

    const dto = toClientSerialized(err);

    expect(dto.details).toEqual({ fieldErrors: { email: ["required"] } });
    expect(JSON.stringify(dto)).not.toContain("internalQuery");
    expect(JSON.stringify(dto)).not.toContain("SELECT");
  });

  it("SCHEMA_MISMATCH.endpoint is DROPPED (leaks internal API topology)", () => {
    const err = makeError({
      code: "SCHEMA_MISMATCH",
      details: { endpoint: "https://internal.api/v2/users" },
    });

    expect(DETAILS_ALLOWLIST.SCHEMA_MISMATCH).toBeNull();
    const dto = toClientSerialized(err);

    expect("details" in dto).toBe(false);
    expect(dto.details).toBeUndefined();
    expect(JSON.stringify(dto)).not.toContain("internal.api");
    expect(JSON.stringify(dto)).not.toContain("endpoint");
  });

  it("RATE_LIMITED.retryAfterMs is ALLOWLISTED and crosses to the client (G1 — public Retry-After)", () => {
    // r5/G1: retryAfterMs is the public Retry-After value (non-sensitive) — it
    // must reach the browser so the countdown copy can interpolate {seconds}.
    expect(DETAILS_ALLOWLIST.RATE_LIMITED).toEqual(["retryAfterMs"]);

    const err = makeError({ code: "RATE_LIMITED", details: { retryAfterMs: 3000 } });
    const dto = toClientSerialized(err);

    expect(dto.code).toBe("RATE_LIMITED");
    expect(dto.userMessageKey).toBe("error.rateLimited");
    expect(dto.details).toEqual({ retryAfterMs: 3000 });
    // the gate alone agrees with the full DTO path
    expect(gateClientDetails("RATE_LIMITED", { retryAfterMs: 3000 })).toEqual({
      retryAfterMs: 3000,
    });
    // JSON-safe round-trip with the allowlisted value intact
    expect(JSON.parse(JSON.stringify(dto)).details).toEqual({ retryAfterMs: 3000 });
  });

  it("RATE_LIMITED with no retryAfterMs (null details) sends NO details (nothing to pick)", () => {
    // The schema is `.nullable()` — a RATE_LIMITED with null details has no
    // allowlisted key present, so the gate omits the field entirely.
    const err = makeError({ code: "RATE_LIMITED", details: null });
    const dto = toClientSerialized(err);
    expect("details" in dto).toBe(false);
    expect(dto.details).toBeUndefined();
  });

  it("HTTP_CLIENT_ERROR.status and HTTP_SERVER_ERROR.status are DROPPED (server-diagnostic)", () => {
    expect(DETAILS_ALLOWLIST.HTTP_CLIENT_ERROR).toBeNull();
    expect(DETAILS_ALLOWLIST.HTTP_SERVER_ERROR).toBeNull();

    const clientErr = makeError({ code: "HTTP_CLIENT_ERROR", details: { status: 418 } });
    const serverErr = makeError({ code: "HTTP_SERVER_ERROR", details: { status: 503 } });

    const clientDto = toClientSerialized(clientErr);
    const serverDto = toClientSerialized(serverErr);

    expect("details" in clientDto).toBe(false);
    expect("details" in serverDto).toBe(false);
    expect(JSON.stringify(clientDto)).not.toContain("418");
    expect(JSON.stringify(serverDto)).not.toContain("503");
  });

  it("gateClientDetails returns undefined for null-rule codes and picks for allowlisted codes", () => {
    // null rule → omit
    expect(gateClientDetails("FORBIDDEN", { requiredRole: "admin" })).toBeUndefined();
    expect(gateClientDetails("NOT_FOUND", { resource: "user:42" })).toBeUndefined();
    // array rule → shallow-pick
    expect(
      gateClientDetails("VALIDATION", { fieldErrors: { a: ["x"] }, leak: 1 }),
    ).toEqual({ fieldErrors: { a: ["x"] } });
    // array rule, no matching keys present → undefined (omit, not empty object)
    expect(gateClientDetails("VALIDATION", { nope: 1 })).toBeUndefined();
    // non-object details under an array rule → undefined
    expect(gateClientDetails("VALIDATION", null)).toBeUndefined();
    expect(gateClientDetails("VALIDATION", "string")).toBeUndefined();
  });

  it("result is JSON-safe: deep round-trips, is a plain object (not a class instance), has no functions", () => {
    const err = makeError({
      code: "VALIDATION",
      details: { fieldErrors: { email: ["required"] } },
      correlationId: "corr-xyz",
      message: "raw server detail that must not leak",
    });

    const dto: ClientSerializedError = toClientSerialized(err, "dig-1");

    // 1) deep round-trips through JSON unchanged
    jsonRoundTrips(dto);
    // 2) not a class instance — a plain serializable object
    expect(dto).not.toBeInstanceOf(DomainError);
    expect(dto).not.toBeInstanceOf(Error);
    expect(Object.getPrototypeOf(dto)).toBe(Object.prototype);
    // 3) no functions anywhere
    expect(hasNoFunctions(dto)).toBe(true);
    // 4) and the message still never leaks
    expect(JSON.stringify(dto)).not.toContain("raw server detail");
  });
});
