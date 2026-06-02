// route-handler — createErrorResponder(system): messageless, details-gated HTTP Response.
// status comes from the catalog defaultHttpStatus; x-request-id carries the correlationId.
import { describe, it, expect } from "vitest";
import { createErrorResponder } from "@/error/route-handler";
import { createDecisionSystem } from "@/error/decision/system";
import { CANONICAL_ERROR_SEMANTICS } from "@/error/decision/catalog";
import { appError } from "@/error/decision/app-error";
import type { OccurrenceContext } from "@/error/decision/types";

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

const respond = createErrorResponder(sys);

describe("createErrorResponder", () => {
  it("uses the catalog defaultHttpStatus for the error code (403 for FORBIDDEN)", async () => {
    const res = respond(appError("FORBIDDEN", { requiredRole: "admin" }), OCCURRENCE, "corr-1");
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("FORBIDDEN");
  });

  it("emits a messageless, details-gated body and an x-request-id header", async () => {
    const secret = "DB at 10.0.0.7 password=hunter2";
    const res = respond(
      appError("HTTP_SERVER_ERROR", { status: 500 }, { message: secret, cause: new Error("boom") }),
      OCCURRENCE,
      "corr-xyz",
    );
    expect(res.status).toBe(500); // HTTP_SERVER_ERROR defaultHttpStatus
    expect(res.headers.get("x-request-id")).toBe("corr-xyz");

    const text = await res.text();
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("10.0.0.7");
    expect(text).not.toContain("boom");
    const body = JSON.parse(text) as Record<string, unknown>;
    expect("message" in body).toBe(false);
    expect(body.details).toBeUndefined(); // HTTP_SERVER_ERROR detailsExposure:'none'
    // HTTP_SERVER_ERROR is a fault → support-only/generic disclosure carries the correlationId
    // into the body as supportCode (the user-facing reference id).
    expect(body.supportCode).toBe("corr-xyz");
  });

  it("wraps an unknown thrown value into the fallback code (500) without leaking it", async () => {
    const res = respond(new TypeError("kaboom-secret"), OCCURRENCE, "corr-2");
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("kaboom-secret");
    const body = JSON.parse(text) as Record<string, unknown>;
    expect(body.code).toBe("UNKNOWN_SERVER_ERROR");
  });
});
