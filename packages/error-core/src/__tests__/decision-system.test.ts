import { describe, it, expect, vi } from "vitest";
import type {
  ClientErrorPayload,
  UserErrorDecision,
  ReporterSink,
  NotifierSink,
  TelemetryContext,
  TelemetryDecision,
} from "../decision/types";
import { createDecisionSystem } from "../decision/system";
import { CANONICAL_ERROR_SEMANTICS } from "../decision/catalog";
import { appError, AppError } from "../decision/app-error";

describe("P3a decision types", () => {
  it("ClientErrorPayload has the unified §5.3 shape", () => {
    const p: ClientErrorPayload = {
      code: "X", messageKey: "k", disclosure: "generic", action: "none",
    };
    expect(p.code).toBe("X");
    // optional fields compile:
    const full: ClientErrorPayload = { ...p, messageVars: { seconds: 5 }, supportCode: "c", retryAfterMs: 1000, correlationId: "r", digest: "d", details: { a: 1 } };
    expect(full.retryAfterMs).toBe(1000);
  });
  it("UserErrorDecision carries optional messageVars", () => {
    const u = { surface: "toast", disclosure: "generic", messageKey: "k", action: "retry", messageVars: { seconds: 5 } } satisfies UserErrorDecision;
    expect(u.messageVars?.seconds).toBe(5);
  });
  it("ReporterSink/NotifierSink reference AppError", () => {
    const r: ReporterSink = { capture() {}, breadcrumb() {} };
    const n: NotifierSink = { alert() {} };
    expect(typeof r.capture).toBe("function");
    expect(typeof n.alert).toBe("function");
  });
});

// ── Task A4: createDecisionSystem factory ──
// CANONICAL_ERROR_SEMANTICS is the catalog; a small operations map covers the boundaries
// the tests exercise.
const sys = createDecisionSystem({
  errors: CANONICAL_ERROR_SEMANTICS,
  operations: {
    "auth.login": {
      operation: "auth.login",
      owner: "sec",
      criticality: "security",
      defaultUiScope: "form",
      piiRisk: true,
    },
    "product.read": {
      operation: "product.read",
      owner: "catalog",
      criticality: "core",
      defaultUiScope: "page",
      piiRisk: false,
    },
    "checkout.pay": {
      operation: "checkout.pay",
      owner: "payments",
      criticality: "revenue",
      defaultUiScope: "form",
      piiRisk: false,
    },
  },
  fallbackErrorCode: "UNKNOWN_SERVER_ERROR",
  validationErrorCode: "VALIDATION",
});

describe("createDecisionSystem (P3a)", () => {
  it("throws at construction on a bad catalog (validateCatalog wired)", () => {
    expect(() =>
      createDecisionSystem({
        errors: {
          // fault/internal can resolve to generic + support-only but has no messageKeys.
          LEAKY: {
            code: "LEAKY",
            category: "fault",
            sensitivity: "internal",
            defaultHttpStatus: 500,
            defaultRetryable: false,
            defaultMessageKey: "raw.internal.detail",
            detailsExposure: "none",
          },
        },
        operations: {},
        fallbackErrorCode: "LEAKY",
      }),
    ).toThrow(/disclosure\/messageKey invariant/);
  });

  it("throws when fallbackErrorCode is absent from the catalog", () => {
    expect(() =>
      createDecisionSystem({ errors: {}, operations: {}, fallbackErrorCode: "MISSING" as never }),
    ).toThrow(/fallbackErrorCode/);
  });

  it("validateMessageKeys:false opts out of the catalog invariant", () => {
    expect(() =>
      createDecisionSystem({
        errors: {
          LEAKY: {
            code: "LEAKY",
            category: "fault",
            sensitivity: "internal",
            defaultHttpStatus: 500,
            defaultRetryable: false,
            defaultMessageKey: "raw.internal.detail",
            detailsExposure: "none",
          },
        },
        operations: {},
        fallbackErrorCode: "LEAKY",
        validateMessageKeys: false,
      }),
    ).not.toThrow();
  });

  it("makeOccurrence runtime-validates unknown operation names", () => {
    expect(() =>
      sys.makeOccurrence("unknown.operation" as never, {
        interaction: "query",
        uiScope: "component",
      }),
    ).toThrow(/Unknown operation/);
  });

  it("finalizeFailure precedence: fieldPath -> uiScope:'field' (call-site over boundary)", () => {
    const result = sys.finalizeFailure(
      sys.fail("VALIDATION", { fieldErrors: { email: ["bad"] } }, { fieldPath: "email" }),
      {
        operation: "auth.login",
        interaction: "form-submit",
        uiScope: "form",
        criticality: "security",
      },
      { runtime: "server" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.occurrence.uiScope).toBe("field");
      expect(result.occurrence.fieldPath).toBe("email");
      expect(result.decision.user.surface).toBe("field");
    }
  });

  it("finalizeFailure: fieldPath-driven uiScope:field is not clobbered by a conflicting occurrence.uiScope", () => {
    const occurrence = sys.makeOccurrence("auth.login", { interaction: "form-submit", uiScope: "form" });
    const result = sys.finalizeFailure(
      sys.fail("VALIDATION", { fieldErrors: { email: ["bad"] } }, {
        fieldPath: "email",
        occurrence: { uiScope: "page" },
      }),
      occurrence,
      { runtime: "server" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.occurrence.uiScope).toBe("field");
      expect(result.occurrence.fieldPath).toBe("email");
      expect(result.decision.user.surface).toBe("field");
    }
  });

  it("finalizeFailure: escape-hatch telemetry override does not bypass decision execution", () => {
    const occurrence = sys.makeOccurrence("checkout.pay", { interaction: "form-submit", uiScope: "form" });
    const result = sys.finalizeFailure(
      sys.fail("UNKNOWN_SERVER_ERROR", null, {
        telemetry: { alert: false, fingerprint: ["checkout.pay", "manual"] },
      }),
      occurrence,
      { runtime: "server" },
    );
    expect(result.decision.telemetry.alert).toBe(false);
    expect(result.decision.telemetry.fingerprint).toEqual(["checkout.pay", "manual"]);
  });

  it("finalize validity gate: invalid details fall back to a safe fault (validateDetails, D1)", () => {
    // A code with a validateDetails guard that rejects the supplied details must degrade to the
    // fallback code rather than expose the bad payload.
    const guarded = createDecisionSystem({
      errors: {
        ...CANONICAL_ERROR_SEMANTICS,
        STRICT: {
          code: "STRICT",
          category: "business",
          sensitivity: "public",
          defaultHttpStatus: 400,
          defaultRetryable: false,
          defaultMessageKey: "error.validation",
          defaultAction: "fix-input",
          detailsExposure: "allowlist",
          detailsAllowlist: ["ok"],
          validateDetails: (d: unknown): d is { ok: true } =>
            typeof d === "object" && d !== null && (d as { ok?: unknown }).ok === true,
        },
      },
      operations: {
        x: { operation: "x", owner: "t", criticality: "normal", defaultUiScope: "form", piiRisk: false },
      },
      fallbackErrorCode: "UNKNOWN_SERVER_ERROR",
    });
    const occurrence = guarded.makeOccurrence("x", { interaction: "form-submit", uiScope: "form" });
    const result = guarded.finalizeFailure(
      guarded.fail("STRICT", { ok: false } as never),
      occurrence,
      { runtime: "server", correlationId: "corr-schema" },
    );
    expect(result.error.code).toBe("UNKNOWN_SERVER_ERROR");
    expect(result.payload.details).toBeUndefined();
    expect(result.decision.user.supportCode).toBe("corr-schema");
  });

  it("toClientErrorPayload/finalizeUnknown emit ONLY the wire shape — never surface/target, never raw message/cause/non-allowlisted details", () => {
    const finalized = sys.finalizeUnknown(
      appError("SCHEMA_MISMATCH", { secret: "x" }, {
        message: "internal detail",
        cause: new Error("boom"),
      }),
      { operation: "product.read", interaction: "query", uiScope: "page", criticality: "core" },
      { runtime: "server", correlationId: "corr-raw" },
    );
    const payload = finalized.payload;
    expect(payload).toBeDefined();
    // No off-wire fields:
    expect((payload as unknown as Record<string, unknown>).surface).toBeUndefined();
    expect((payload as unknown as Record<string, unknown>).target).toBeUndefined();
    // No raw leaks:
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("internal detail");
    expect(serialized).not.toContain("boom");
    expect(serialized).not.toContain("secret"); // SCHEMA_MISMATCH detailsExposure:'none'
    // Has the unified shape:
    expect(payload.messageKey).toBeDefined();
    expect(payload.disclosure).toBe("support-only");
    expect(payload.supportCode).toBe("corr-raw");
  });

  it("full AppError never serializes into the payload (leak test)", () => {
    const finalized = sys.finalizeUnknown(
      appError("HTTP_SERVER_ERROR", { stackTraceFragment: "at db.query (secret.ts:42)" }, {
        message: "raw server message",
        cause: new Error("upstream blew up"),
        correlationId: "c-1",
      }),
      { operation: "product.read", interaction: "query", uiScope: "page", criticality: "core" },
      { runtime: "server", correlationId: "c-1" },
    );
    const serialized = JSON.stringify(finalized.payload);
    expect(serialized).not.toContain("raw server message");
    expect(serialized).not.toContain("upstream blew up");
    expect(serialized).not.toContain("stackTraceFragment");
    expect(serialized).not.toContain("secret.ts");
    // payload keys are bounded to the wire shape (no `error`, `cause`, `stack`, `name`):
    const keys = Object.keys(finalized.payload);
    for (const banned of ["error", "cause", "stack", "name", "surface", "target", "occurrence"]) {
      expect(keys).not.toContain(banned);
    }
  });

  it("single allowlist parity: VALIDATION exposes fieldErrors and drops sibling 'extra'", () => {
    const finalized = sys.finalizeFailure(
      sys.fail("VALIDATION", { fieldErrors: { a: ["x"] }, extra: "drop" } as never, { fieldPath: "a" }),
      { operation: "auth.login", interaction: "form-submit", uiScope: "field", criticality: "normal" },
      { runtime: "server" },
    );
    const details = finalized.payload.details as Record<string, unknown> | undefined;
    expect(details?.fieldErrors).toEqual({ a: ["x"] });
    expect(details?.extra).toBeUndefined();
  });

  it("single allowlist is shallow — preserves nested fieldErrors (D7, SEC-4)", () => {
    const finalized = sys.finalizeFailure(
      sys.fail("VALIDATION", { fieldErrors: { email: ["one", "two"], password: ["short"] } }, {
        fieldPath: "email",
      }),
      { operation: "auth.login", interaction: "form-submit", uiScope: "field", criticality: "normal" },
      { runtime: "server" },
    );
    const details = finalized.payload.details as { fieldErrors: Record<string, string[]> };
    expect(details.fieldErrors.email).toEqual(["one", "two"]);
    expect(details.fieldErrors.password).toEqual(["short"]);
  });

  it("single allowlist parity: SCHEMA_MISMATCH/HTTP_* expose no details (detailsExposure:'none')", () => {
    const schema = sys.toClientErrorPayload(
      appError("SCHEMA_MISMATCH", { providerCode: "X", dbHost: "internal" }),
      sys.resolveErrorDecision({
        error: appError("SCHEMA_MISMATCH", { providerCode: "X" }),
        semantics: CANONICAL_ERROR_SEMANTICS.SCHEMA_MISMATCH,
        occurrence: { operation: "o", interaction: "query", uiScope: "page", criticality: "core" },
        runtime: { runtime: "server" },
      }),
    );
    expect(schema.details).toBeUndefined();

    const http = sys.toClientErrorPayload(
      appError("HTTP_SERVER_ERROR", { upstream: "leak" }),
      sys.resolveErrorDecision({
        error: appError("HTTP_SERVER_ERROR", { upstream: "leak" }),
        semantics: CANONICAL_ERROR_SEMANTICS.HTTP_SERVER_ERROR,
        occurrence: { operation: "o", interaction: "query", uiScope: "page", criticality: "core" },
        runtime: { runtime: "server" },
      }),
    );
    expect(http.details).toBeUndefined();
  });

  it("RATE_LIMITED exposes retryAfterMs via the allowlist and threads the instance retryAfterMs (D5)", () => {
    const finalized = sys.finalizeFailure(
      sys.fail("RATE_LIMITED", { retryAfterMs: 5000 }, { retryAfterMs: 5000 }),
      { operation: "product.read", interaction: "query", uiScope: "component", criticality: "core" },
      { runtime: "client" },
    );
    const details = finalized.payload.details as { retryAfterMs?: number } | undefined;
    expect(details?.retryAfterMs).toBe(5000);
    expect(finalized.payload.retryAfterMs).toBe(5000);
    // P2(리뷰): {seconds}는 resolve가 중앙 도출 — payload·ErrorFallback·Presenter가 같은 카운트다운을 받는다.
    expect(finalized.decision.user.messageVars).toEqual({ seconds: 5 });
    expect(finalized.payload.messageVars).toEqual({ seconds: 5 });
  });

  it("finalizeUnknown wraps a non-AppError into the fallback code", () => {
    const finalized = sys.finalizeUnknown(
      new TypeError("boom"),
      { operation: "product.read", interaction: "query", uiScope: "page", criticality: "core" },
      { runtime: "server" },
    );
    expect(finalized.error).toBeInstanceOf(AppError);
    expect(finalized.error.code).toBe("UNKNOWN_SERVER_ERROR");
    expect(JSON.stringify(finalized.payload)).not.toContain("boom");
  });

  it("supportCode comes from correlationId for support-only/generic-fault disclosures", () => {
    const finalized = sys.finalizeUnknown(
      appError("SCHEMA_MISMATCH"),
      { operation: "product.read", interaction: "query", uiScope: "page", criticality: "core" },
      { runtime: "server", correlationId: "corr-1" },
    );
    expect(finalized.decision.user.disclosure).toBe("support-only");
    expect(finalized.decision.user.supportCode).toBe("corr-1");
  });

  it("promotes AppError.correlationId to supportCode when runtime lacks it", () => {
    const finalized = sys.finalizeUnknown(
      appError("SCHEMA_MISMATCH", {}, { correlationId: "from-error" }),
      { operation: "product.read", interaction: "query", uiScope: "page", criticality: "core" },
      { runtime: "server" }, // no correlationId in runtime
    );
    expect(finalized.ok).toBe(false);
    if (!finalized.ok) {
      expect(finalized.decision.user.supportCode).toBe("from-error");
      expect(finalized.payload.correlationId).toBe("from-error");
    }
  });
});

describe("createDecisionSystem telemetry execution (P3a)", () => {
  const decision: TelemetryDecision = {
    capture: true,
    level: "warning",
    breadcrumb: true,
    alert: false,
    sampleRate: 0.1,
  };
  const ctx: TelemetryContext = { runtime: "client", operation: "product.read" };

  const run = (sampler: () => number) => {
    const system = createDecisionSystem({
      errors: CANONICAL_ERROR_SEMANTICS,
      operations: {},
      fallbackErrorCode: "UNKNOWN_SERVER_ERROR",
      sampler,
    });
    let captured = 0;
    let breadcrumbs = 0;
    system.executeTelemetryDecision(appError("TIMEOUT"), decision, ctx, {
      reporter: { capture: () => captured++, breadcrumb: () => breadcrumbs++ },
      notifier: { alert: () => undefined },
    });
    return { captured, breadcrumbs };
  };

  it("captures when the injected sampler falls under sampleRate", () => {
    expect(run(() => 0.05)).toEqual({ captured: 1, breadcrumbs: 1 });
  });

  it("drops capture when the sampler is above sampleRate, but breadcrumb still fires", () => {
    expect(run(() => 0.5)).toEqual({ captured: 0, breadcrumbs: 1 });
  });

  it("executeErrorDecision runs telemetry and returns the user decision", () => {
    const occurrence = sys.makeOccurrence("checkout.pay", { interaction: "form-submit", uiScope: "form" });
    const failure = sys.finalizeUnknown(appError("UNKNOWN_SERVER_ERROR"), occurrence, { runtime: "server" });
    const capture = vi.fn();
    const user = sys.executeErrorDecision(
      failure.error,
      failure.decision,
      { runtime: "server", operation: "checkout.pay" },
      { reporter: { capture, breadcrumb: vi.fn() }, notifier: { alert: vi.fn() } },
    );
    expect(user).toBe(failure.decision.user);
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("executeTelemetryDecision obeys the decision booleans without reinterpreting severity", () => {
    const occurrence = sys.makeOccurrence("checkout.pay", { interaction: "form-submit", uiScope: "form" });
    const result = sys.finalizeUnknown(appError("UNKNOWN_SERVER_ERROR"), occurrence, { runtime: "server" });
    const capture = vi.fn();
    const breadcrumb = vi.fn();
    const alert = vi.fn();
    sys.executeTelemetryDecision(
      result.error,
      { ...result.decision.telemetry, capture: false, breadcrumb: true, alert: false, level: "fatal" },
      { runtime: "server", operation: "checkout.pay" },
      { reporter: { capture, breadcrumb }, notifier: { alert } },
    );
    expect(capture).not.toHaveBeenCalled();
    expect(breadcrumb).toHaveBeenCalledTimes(1);
    expect(alert).not.toHaveBeenCalled();
  });
});

describe("createDecisionSystem per-code typed fail (P3a, B1)", () => {
  it("system.fail returns a typed draft for valid details", () => {
    const draft = sys.fail("VALIDATION", { fieldErrors: { email: ["bad"] } });
    expect(draft.code).toBe("VALIDATION");
    expect(draft.details).toEqual({ fieldErrors: { email: ["bad"] } });
  });

  it("rejects the wrong details shape per code at compile time (D1 active via validateDetails)", () => {
    // VALIDATION's catalog validateDetails guard makes DetailsOf<…,"VALIDATION"> =
    // { fieldErrors: Record<string,string[]> }. A mismatched shape is a TYPE error.
    // @ts-expect-error — { wrong: true } is not the VALIDATION details shape.
    sys.fail("VALIDATION", { wrong: true });
    // @ts-expect-error — RATE_LIMITED requires { retryAfterMs: number }.
    sys.fail("RATE_LIMITED", { retryAfterMs: "soon" });
    expect(true).toBe(true);
  });
});
