import { describe, it, expect } from "vitest";
import { resolveErrorDecision, type ErrorDecisionInput } from "../decision/resolve";
import { CANONICAL_ERROR_SEMANTICS } from "../decision/catalog";
import type { OccurrenceContext, RuntimeContext } from "../decision/types";

const runtime: RuntimeContext = { runtime: "server" };

const decide = (
  code: keyof typeof CANONICAL_ERROR_SEMANTICS,
  occurrence: OccurrenceContext,
  errorExtra: { retryAfterMs?: number; userCanRetry?: boolean } = {},
) => {
  const input: ErrorDecisionInput = {
    error: { code, ...errorExtra },
    semantics: CANONICAL_ERROR_SEMANTICS[code],
    occurrence,
    runtime,
  };
  return resolveErrorDecision(input);
};

const occ = (over: Partial<OccurrenceContext>): OccurrenceContext => ({
  operation: "test.op",
  interaction: "form-submit",
  uiScope: "form",
  criticality: "normal",
  ...over,
});

describe("resolveErrorDecision — scenario matrix (canonical catalog)", () => {
  it("VALIDATION + field → field surface, specific disclosure, fix-input, no capture", () => {
    const d = decide("VALIDATION", occ({ interaction: "form-submit", uiScope: "field", fieldPath: "email" }));
    expect(d.user.surface).toBe("field");
    expect(d.user.disclosure).toBe("specific");
    expect(d.user.action).toBe("fix-input");
    expect(d.telemetry.capture).toBe(false);
  });

  it("INVALID_CREDENTIALS + login form → form surface, safe-vague disclosure", () => {
    const d = decide("INVALID_CREDENTIALS", occ({ uiScope: "form", criticality: "security" }));
    expect(d.user.surface).toBe("form");
    expect(d.user.disclosure).toBe("safe-vague");
  });

  it("AUTH_REQUIRED + route-guard → redirect surface, login action", () => {
    const d = decide("AUTH_REQUIRED", occ({ interaction: "route-guard", uiScope: "page", criticality: "security" }));
    expect(d.user.surface).toBe("redirect");
    expect(d.user.action).toBe("login");
    expect(d.user.target).toBe("/login");
  });

  it("FORBIDDEN + admin page → page surface, safe-vague, warning capture", () => {
    const d = decide("FORBIDDEN", occ({ interaction: "route-guard", uiScope: "page", criticality: "security" }));
    expect(d.user.surface).toBe("page");
    expect(d.user.disclosure).toBe("safe-vague");
    expect(d.telemetry.capture).toBe(true);
  });

  it("SCHEMA_MISMATCH + page query (core) → page surface, support-only, capture", () => {
    const d = decide("SCHEMA_MISMATCH", occ({ interaction: "query", uiScope: "page", criticality: "core" }));
    expect(d.user.surface).toBe("page");
    expect(d.user.disclosure).toBe("support-only");
    expect(d.telemetry.capture).toBe(true);
    expect(d.telemetry.alert).toBe(true);
    expect(d.telemetry.level).toBe("fatal");
  });

  it("TIMEOUT + non-idempotent checkout submit → dialog surface, wait action, generic disclosure", () => {
    const d = decide("TIMEOUT", occ({ interaction: "form-submit", uiScope: "form", criticality: "revenue", idempotent: false }));
    expect(d.user.surface).toBe("dialog");
    expect(d.user.action).toBe("wait");
    expect(d.user.disclosure).toBe("generic");
  });

  it("NETWORK_ERROR + background prefetch → silent surface", () => {
    const d = decide("NETWORK_ERROR", occ({ interaction: "background-sync", uiScope: "background", criticality: "low" }));
    expect(d.user.surface).toBe("silent");
  });
});
