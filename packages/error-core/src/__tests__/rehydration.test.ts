// §10.1 rehydration round-trip — the serialization-safe identity.
//
// Proves that pushing a DomainError through its wire DTO and back yields an
// equivalent DomainError: normalize(err.toSerialized()) ≡ normalize(err) for a
// validation error (with fieldErrors), a NOT_FOUND, and a server code; that
// fromSerialized preserves code/correlationId/digest; that toSerialized round-
// trips digest; and that plain values map to UNKNOWN_SERVER_ERROR on the server
// (UNKNOWN_CLIENT_ERROR once `window` is stubbed). All inputs are built via
// makeError — the single creation path.
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError, isAppError, type SerializedError } from "@/error/decision/app-error";
import { makeError } from "@/error/make-error";
import { normalizeToAppError } from "@/error/normalize";
import { getRuntime } from "@/error/runtime";

// Compare two AppErrors on their observable, serialization-stable surface.
// (We deliberately avoid expect(err).toEqual(err2) on the class instances —
// Error carries a non-deterministic stack; the wire contract is toSerialized().)
const wire = (e: AppError): SerializedError => e.toSerialized();

describe("§10.1 rehydration round-trip — serialization-safe identity", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("VALIDATION (with fieldErrors): normalize(toSerialized) deep-equals normalize(original)", () => {
    const err = makeError({
      code: "VALIDATION",
      details: { fieldErrors: { email: ["required", "invalid"], name: ["required"] } },
      correlationId: "corr-validation",
    });

    const direct = normalizeToAppError(err);
    const rehydrated = normalizeToAppError(err.toSerialized());

    // Identity across the wire: both paths converge on the same observable shape.
    expect(wire(rehydrated)).toEqual(wire(direct));
    expect(rehydrated.code).toBe("VALIDATION");
    expect(rehydrated.details).toEqual({
      fieldErrors: { email: ["required", "invalid"], name: ["required"] },
    });
    expect(rehydrated.correlationId).toBe("corr-validation");
  });

  it("NOT_FOUND: normalize(toSerialized) deep-equals normalize(original)", () => {
    const err = makeError({
      code: "NOT_FOUND",
      details: { resource: "user" },
      correlationId: "corr-nf",
    });

    const direct = normalizeToAppError(err);
    const rehydrated = normalizeToAppError(err.toSerialized());

    expect(wire(rehydrated)).toEqual(wire(direct));
    expect(rehydrated.code).toBe("NOT_FOUND");
    expect(rehydrated.details).toEqual({ resource: "user" });
  });

  it("a server code (HTTP_SERVER_ERROR): normalize(toSerialized) deep-equals normalize(original)", () => {
    const err = makeError({
      code: "HTTP_SERVER_ERROR",
      details: { status: 500 },
      correlationId: "corr-500",
    });

    const direct = normalizeToAppError(err);
    const rehydrated = normalizeToAppError(err.toSerialized());

    expect(wire(rehydrated)).toEqual(wire(direct));
    expect(rehydrated.code).toBe("HTTP_SERVER_ERROR");
    expect(rehydrated.details).toEqual({ status: 500 });
  });

  it("the wire DTO survives a real JSON round-trip (structural identity, no ghost keys)", () => {
    const err = makeError({
      code: "VALIDATION",
      details: { fieldErrors: { email: ["required"] } },
      correlationId: "corr-json",
    });

    const overWire: SerializedError = JSON.parse(JSON.stringify(err.toSerialized()));
    const rehydrated = normalizeToAppError(overWire);

    expect(rehydrated.toSerialized()).toEqual(err.toSerialized());
    // omit-undefined contract: no correlationId/digest ghost keys when absent.
    const bare = makeError({ code: "NOT_FOUND", details: null }).toSerialized();
    expect(Object.keys(bare).sort()).toEqual(["code", "details", "message"]);
    expect("correlationId" in bare).toBe(false);
    expect("digest" in bare).toBe(false);
  });

  it("AppError.fromSerialized preserves code, correlationId and digest", () => {
    const payload: SerializedError = {
      code: "NOT_FOUND",
      message: "no such row",
      details: { resource: "order" },
      correlationId: "corr-from",
      digest: "digest-abc123",
    };

    const rebuilt = AppError.fromSerialized(payload);

    expect(isAppError(rebuilt)).toBe(true);
    expect(rebuilt.code).toBe("NOT_FOUND");
    expect(rebuilt.details).toEqual({ resource: "order" });
    expect(rebuilt.correlationId).toBe("corr-from");
    expect(rebuilt.digest).toBe("digest-abc123");
    expect(rebuilt.message).toBe("no such row");
  });

  it("toSerialized round-trips the digest (set via makeError, recovered via fromSerialized)", () => {
    const err = makeError({
      code: "HTTP_SERVER_ERROR",
      details: { status: 503 },
      digest: "rsc-digest-42",
      correlationId: "corr-digest",
    });

    expect(err.digest).toBe("rsc-digest-42");

    const serialized = err.toSerialized();
    expect(serialized.digest).toBe("rsc-digest-42");

    const rebuilt = AppError.fromSerialized(serialized);
    expect(rebuilt.digest).toBe("rsc-digest-42");
    expect(rebuilt.correlationId).toBe("corr-digest");
    // digest survives a full wire trip through normalize as well.
    const viaNormalize = normalizeToAppError(JSON.parse(JSON.stringify(serialized)));
    expect(viaNormalize.digest).toBe("rsc-digest-42");
  });

  it("a corrupt/forged details payload rehydrates verbatim (validity gating moved to finalize, D1)", () => {
    // P3b-ii: AppError.fromSerialized is a pure rebuild — it no longer re-validates details
    // against a per-code zod schema. Invalid/forged details are caught later at finalize time
    // via the catalog's `validateDetails` (D1), which degrades to the safe fallback fault so
    // a bad payload never reaches the client allowlist. fromSerialized just preserves the
    // wire shape (code + correlationId + digest + details) so the support trail survives.
    const forged: SerializedError = {
      code: "NOT_FOUND",
      message: "tampered",
      details: 12345,
      correlationId: "corr-forged",
      digest: "digest-forged",
    };

    const rebuilt = AppError.fromSerialized(forged);

    // The code/correlationId/digest survive; details are preserved as-is (gated downstream).
    expect(rebuilt.code).toBe("NOT_FOUND");
    expect(rebuilt.details).toBe(12345);
    expect(rebuilt.correlationId).toBe("corr-forged");
    expect(rebuilt.digest).toBe("digest-forged");
  });

  it("a plain Error → UNKNOWN_SERVER_ERROR in node, stamping the supplied correlationId", () => {
    expect(getRuntime()).toBe("server");

    const rebuilt = normalizeToAppError(new Error("boom"), "fallback msg", "corr-plain");

    expect(rebuilt.code).toBe("UNKNOWN_SERVER_ERROR");
    expect(rebuilt.correlationId).toBe("corr-plain");
    expect(rebuilt.message).toBe("fallback msg");
  });

  it("a plain Error → UNKNOWN_CLIENT_ERROR when window is stubbed (client runtime)", () => {
    vi.stubGlobal("window", {});
    expect(getRuntime()).toBe("client");

    const rebuilt = normalizeToAppError(new Error("boom"));

    expect(rebuilt.code).toBe("UNKNOWN_CLIENT_ERROR");
  });

  it("an already-DomainError input is returned and stamped with the ctx correlationId when absent", () => {
    const err = makeError({ code: "NOT_FOUND", details: null });
    expect(err.correlationId).toBeUndefined();

    // Branch 1: instance passes through. correlationId absent → stamped from ctx.
    const stamped = normalizeToAppError(err, undefined, "ctx-corr");
    expect(isAppError(stamped)).toBe(true);
    expect(stamped.code).toBe("NOT_FOUND");
    expect(stamped.correlationId).toBe("ctx-corr");

    // An instance that already carries a correlationId is returned untouched
    // (same reference — no rebuild).
    const withId = makeError({ code: "NOT_FOUND", details: null, correlationId: "own-corr" });
    const passedThrough = normalizeToAppError(withId, undefined, "ctx-corr");
    expect(passedThrough).toBe(withId);
    expect(passedThrough.correlationId).toBe("own-corr");
  });
});
