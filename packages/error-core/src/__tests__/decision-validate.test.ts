import { describe, it, expect } from "vitest";
import { validateCatalog } from "../decision/validate";
import { CANONICAL_ERROR_SEMANTICS } from "../decision/catalog";
import type { ErrorCatalog } from "../decision/types";

describe("validateCatalog", () => {
  it("passes for the canonical catalog with a valid fallbackErrorCode", () => {
    expect(() => validateCatalog(CANONICAL_ERROR_SEMANTICS, "UNKNOWN_SERVER_ERROR")).not.toThrow();
  });

  it("throws when fallbackErrorCode is absent from the catalog", () => {
    expect(() => validateCatalog(CANONICAL_ERROR_SEMANTICS, "NOT_A_CODE")).toThrow(/fallbackErrorCode/);
  });

  it("throws when a reachable disclosure level lacks a safe messageKey", () => {
    const broken: ErrorCatalog = {
      LEAKY: {
        code: "LEAKY", category: "business", sensitivity: "auth",
        defaultHttpStatus: 401, defaultRetryable: false,
        defaultMessageKey: "secret.reason",
        detailsExposure: "none",
      },
      UNKNOWN_SERVER_ERROR: CANONICAL_ERROR_SEMANTICS.UNKNOWN_SERVER_ERROR,
    };
    expect(() => validateCatalog(broken, "UNKNOWN_SERVER_ERROR")).toThrow(/disclosure\/messageKey invariant/);
  });
});
