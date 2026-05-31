// t-new (G12) — field-errors.ts
//
// fieldErrorsFromError(error) returns error.details.fieldErrors when error.code ===
// "VALIDATION", else null (for any other DomainError code, or a non-DomainError).
// This feeds the query-track VALIDATION inline branch so a form can render per-field
// errors without re-deriving the shape at the call site.
import { describe, it, expect } from "vitest";

import { fieldErrorsFromError } from "@/error/field-errors";
import { makeError } from "@/error/make-error";

describe("fieldErrorsFromError (G12)", () => {
  it("returns the fieldErrors map for a VALIDATION DomainError", () => {
    const fieldErrors = { email: ["required", "invalid"], password: ["too short"] };
    const error = makeError({ code: "VALIDATION", details: { fieldErrors } });

    expect(fieldErrorsFromError(error)).toEqual(fieldErrors);
  });

  it("returns an empty record (not null) when VALIDATION has no field entries", () => {
    const error = makeError({ code: "VALIDATION", details: { fieldErrors: {} } });

    expect(fieldErrorsFromError(error)).toEqual({});
  });

  it("returns null for a non-VALIDATION DomainError code", () => {
    const error = makeError({ code: "NOT_FOUND", details: { resource: "doc" } });

    expect(fieldErrorsFromError(error)).toBeNull();
  });

  it("returns null for a non-DomainError input", () => {
    expect(fieldErrorsFromError(new Error("plain"))).toBeNull();
    expect(fieldErrorsFromError(null)).toBeNull();
    expect(fieldErrorsFromError(undefined)).toBeNull();
    expect(fieldErrorsFromError({ code: "VALIDATION" })).toBeNull(); // plain object, not an instance
  });
});
