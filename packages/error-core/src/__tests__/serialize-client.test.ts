// §10 / §5.3 — LEAK-PREVENTION enforcement point.
// P3c: the single leak gate is `system.toClientErrorPayload(error, decision)` (decision/system),
// driven through `finalizeUnknown(...).payload`. The old per-code DETAILS_ALLOWLIST /
// gateClientDetails / toClientSerialized free functions were deleted — this file is migrated to
// exercise the SAME leak invariants against the unified gate, code by code.
//
// PRESERVED invariants (NOT weakened):
//  • raw free-text message NEVER reaches the payload
//  • cause NEVER reaches the payload
//  • the payload is JSON-safe (deep round-trips, plain object, no functions)
//  • non-allowlisted sibling keys are stripped (shallow pick)
//  • VALIDATION.fieldErrors PASSES (allowlist)
//  • RATE_LIMITED.retryAfterMs PASSES (allowlist — public Retry-After)
//  • FORBIDDEN.requiredRole / NOT_FOUND.resource / SCHEMA_MISMATCH.endpoint / HTTP_*.status WITHHELD
//  • surface/target are ABSENT from the wire payload
//  • the full AppError (stack/name/cause/occurrence) NEVER serializes
import { describe, it, expect } from "vitest";
import { createDecisionSystem } from "@/error/decision/system";
import { CANONICAL_ERROR_SEMANTICS } from "@/error/decision/catalog";
import { appError, AppError } from "@/error/decision/app-error";
import type { ClientErrorPayload, OccurrenceContext } from "@/error/decision/types";

// A test decision-system over the canonical catalog. Operations cover the boundaries exercised.
const sys = createDecisionSystem({
  errors: CANONICAL_ERROR_SEMANTICS,
  operations: {
    "product.read": {
      operation: "product.read",
      owner: "catalog",
      criticality: "core",
      defaultUiScope: "page",
      piiRisk: false,
    },
  },
  fallbackErrorCode: "UNKNOWN_SERVER_ERROR",
  validationErrorCode: "VALIDATION",
});

const OCCURRENCE: OccurrenceContext<"product.read"> = {
  operation: "product.read",
  interaction: "query",
  uiScope: "page",
  criticality: "core",
};

/**
 * Run an AppError (or any thrown value) through the SINGLE leak gate and return the wire payload.
 * Server runtime — the harshest disclosure for fault codes. correlationId threads to supportCode.
 */
const gate = (error: AppError, correlationId = "corr-test"): ClientErrorPayload =>
  sys.finalizeUnknown(error, OCCURRENCE, { runtime: "server", correlationId }).payload;

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

describe("toClientErrorPayload (§5.3/§10 leak prevention)", () => {
  it("DROPS the free-text message — no raw server message leaks to the client payload", () => {
    const secret = "DB connection refused at 10.0.0.7: password=hunter2";
    const payload = gate(
      appError("HTTP_SERVER_ERROR", { status: 500 }, { message: secret }),
    );

    // No `message` field whatsoever on the client payload.
    expect("message" in payload).toBe(false);
    expect((payload as unknown as Record<string, unknown>).message).toBeUndefined();
    // The secret string must not appear anywhere in the serialized payload.
    expect(JSON.stringify(payload)).not.toContain("hunter2");
    expect(JSON.stringify(payload)).not.toContain("10.0.0.7");
  });

  it("keeps code + messageKey + correlationId", () => {
    // The payload's correlationId is threaded off the AppError instance (decision/system:251).
    const payload = gate(
      appError("VALIDATION", { fieldErrors: { email: ["required"] } }, { correlationId: "corr-123" }),
    );

    expect(payload.code).toBe("VALIDATION");
    // messageKey is resolved off the catalog (public VALIDATION → default key).
    expect(payload.messageKey).toBe("error.validation");
    expect(payload.correlationId).toBe("corr-123");
  });

  it("when correlationId is absent the key is omitted and JSON stays clean", () => {
    // finalizeUnknown threads no correlationId → payload omits the key.
    const payload = sys.finalizeUnknown(
      appError("VALIDATION", { fieldErrors: { name: ["too short"] } }),
      OCCURRENCE,
      { runtime: "server" },
    ).payload;

    expect("correlationId" in payload).toBe(false);
    const wire = JSON.parse(JSON.stringify(payload));
    expect("correlationId" in wire).toBe(false);
    expect(payload.code).toBe("VALIDATION");
    expect(payload.details).toEqual({ fieldErrors: { name: ["too short"] } });
  });

  it("threads digest only when present on the error", () => {
    const withDigest = gate(appError("AUTH_REQUIRED", null, { digest: "dig-abc" }));
    expect(withDigest.digest).toBe("dig-abc");

    const without = gate(appError("AUTH_REQUIRED", null));
    expect("digest" in without).toBe(false);
  });

  it("VALIDATION.fieldErrors is PRESERVED by the allowlist", () => {
    const fieldErrors = { email: ["invalid"], age: ["must be >= 18"] };
    const payload = gate(appError("VALIDATION", { fieldErrors }));

    expect(payload.details).toBeDefined();
    expect(payload.details).toEqual({ fieldErrors });
  });

  it("shallow-picks ONLY allowlisted keys — non-allowlisted sibling keys are dropped", () => {
    // details carry an extra (non-allowlisted) key alongside fieldErrors — the picker drops siblings.
    const payload = gate(
      appError("VALIDATION", {
        fieldErrors: { email: ["required"] },
        // not in the VALIDATION allowlist — must be stripped:
        internalQuery: "SELECT * FROM users WHERE secret=1",
      }),
    );

    expect(payload.details).toEqual({ fieldErrors: { email: ["required"] } });
    expect(JSON.stringify(payload)).not.toContain("internalQuery");
    expect(JSON.stringify(payload)).not.toContain("SELECT");
  });

  it("SCHEMA_MISMATCH.endpoint is DROPPED (leaks internal API topology)", () => {
    // SCHEMA_MISMATCH detailsExposure:'none' → no details at all.
    expect(CANONICAL_ERROR_SEMANTICS.SCHEMA_MISMATCH.detailsExposure).toBe("none");
    const payload = gate(appError("SCHEMA_MISMATCH", { endpoint: "https://internal.api/v2/users" }));

    expect("details" in payload).toBe(false);
    expect(payload.details).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain("internal.api");
    expect(JSON.stringify(payload)).not.toContain("endpoint");
  });

  it("RATE_LIMITED.retryAfterMs is ALLOWLISTED and crosses to the client (public Retry-After)", () => {
    // retryAfterMs is the public Retry-After value (non-sensitive) — it must reach the browser.
    expect(CANONICAL_ERROR_SEMANTICS.RATE_LIMITED.detailsExposure).toBe("allowlist");
    expect(CANONICAL_ERROR_SEMANTICS.RATE_LIMITED.detailsAllowlist).toEqual(["retryAfterMs"]);

    const payload = gate(appError("RATE_LIMITED", { retryAfterMs: 3000 }), "corr-rl");

    expect(payload.code).toBe("RATE_LIMITED");
    expect(payload.messageKey).toBe("error.rateLimited");
    expect(payload.details).toEqual({ retryAfterMs: 3000 });
    // JSON-safe round-trip with the allowlisted value intact
    expect(JSON.parse(JSON.stringify(payload)).details).toEqual({ retryAfterMs: 3000 });
  });

  it("RATE_LIMITED with null details sends NO details (nothing to pick)", () => {
    // null details → no allowlisted key present → the gate omits the field entirely.
    const payload = gate(appError("RATE_LIMITED", null));
    expect("details" in payload).toBe(false);
    expect(payload.details).toBeUndefined();
  });

  it("HTTP_CLIENT_ERROR.status and HTTP_SERVER_ERROR.status are DROPPED (server-diagnostic)", () => {
    expect(CANONICAL_ERROR_SEMANTICS.HTTP_CLIENT_ERROR.detailsExposure).toBe("none");
    expect(CANONICAL_ERROR_SEMANTICS.HTTP_SERVER_ERROR.detailsExposure).toBe("none");

    const clientPayload = gate(appError("HTTP_CLIENT_ERROR", { status: 418 }));
    const serverPayload = gate(appError("HTTP_SERVER_ERROR", { status: 503 }));

    expect("details" in clientPayload).toBe(false);
    expect("details" in serverPayload).toBe(false);
    expect(JSON.stringify(clientPayload)).not.toContain("418");
    expect(JSON.stringify(serverPayload)).not.toContain("503");
  });

  it("FORBIDDEN.requiredRole and NOT_FOUND.resource are WITHHELD (none-rule codes)", () => {
    // null-rule equivalents under the unified gate: detailsExposure:'none' → omit entirely.
    expect(CANONICAL_ERROR_SEMANTICS.FORBIDDEN.detailsExposure).toBe("none");
    expect(CANONICAL_ERROR_SEMANTICS.NOT_FOUND.detailsExposure).toBe("none");

    const forbidden = gate(appError("FORBIDDEN", { requiredRole: "admin" }));
    const notFound = gate(appError("NOT_FOUND", { resource: "user:42" }));

    expect(forbidden.details).toBeUndefined();
    expect(notFound.details).toBeUndefined();
    expect(JSON.stringify(forbidden)).not.toContain("admin");
    expect(JSON.stringify(notFound)).not.toContain("user:42");
  });

  it("array-rule with no matching keys present yields undefined (omit, not empty object)", () => {
    // VALIDATION allowlist=['fieldErrors']; details with no matching key → details omitted.
    const payload = gate(appError("VALIDATION", { nope: 1 }));
    expect(payload.details).toBeUndefined();
  });

  it("non-object details under an allowlist rule yields undefined", () => {
    // A non-object under an allowlist rule cannot expose any key → details omitted.
    expect(gate(appError("VALIDATION", null)).details).toBeUndefined();
    expect(gate(appError("VALIDATION", "string")).details).toBeUndefined();
  });

  it("payload is JSON-safe: deep round-trips, plain object (not a class instance), no functions, surface/target absent, full AppError never serializes", () => {
    const payload = gate(
      appError(
        "VALIDATION",
        { fieldErrors: { email: ["required"] } },
        { message: "raw server detail that must not leak", cause: new Error("upstream"), digest: "dig-1" },
      ),
      "corr-xyz",
    );

    // 1) deep round-trips through JSON unchanged
    jsonRoundTrips(payload);
    // 2) not a class instance — a plain serializable object
    expect(payload).not.toBeInstanceOf(AppError);
    expect(payload).not.toBeInstanceOf(Error);
    expect(Object.getPrototypeOf(payload)).toBe(Object.prototype);
    // 3) no functions anywhere
    expect(hasNoFunctions(payload)).toBe(true);
    // 4) the message + cause still never leak
    expect(JSON.stringify(payload)).not.toContain("raw server detail");
    expect(JSON.stringify(payload)).not.toContain("upstream");
    // 5) surface/target are NEVER on the wire payload; nor is any full-AppError carrier key.
    const keys = Object.keys(payload);
    for (const banned of ["surface", "target", "error", "cause", "stack", "name", "occurrence", "message"]) {
      expect(keys).not.toContain(banned);
    }
  });
});
