import { describe, expect, it, vi } from "vitest";
import {
  decisionSystem,
  loginAction,
  signupAction,
  checkoutAction,
  DEMO_ERRORS,
  DEMO_OPERATIONS,
  translate,
} from "../demo";
import {
  appError,
  createDecisionSystem,
  fail,
  type ErrorDecision,
  type TelemetryContext,
  type TelemetryDecision,
} from "../index";
import { ErrorSurface } from "../react";

describe("idempotency safety (finding #4)", () => {
  it("a non-idempotent retryable submit becomes a confirm dialog with a wait action", async () => {
    const result = await checkoutAction({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.occurrence.idempotent).toBe(false);
    expect(result.decision.user.surface).toBe("dialog");
    expect(result.decision.user.action).toBe("wait");
  });

  it("an idempotent retryable operation still retries", () => {
    const occurrence = decisionSystem.makeOccurrence("checkout.pay", {
      interaction: "form-submit",
      uiScope: "form",
    });
    const result = decisionSystem.finalizeUnknown(
      appError("TIMEOUT", null, { userCanRetry: true, occurrence: { idempotent: true } }),
      occurrence,
      { runtime: "server" },
    );
    expect(result.decision.user.action).toBe("retry");
    expect(result.decision.user.surface).toBe("form");
  });
});

describe("3-arg defineFormAction schema (finding #2)", () => {
  it("a schema parse failure short-circuits to a VALIDATION decision with client-safe fieldErrors", async () => {
    const result = await signupAction({ email: "bad", password: "x" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION");
    expect(result.decision.user.surface).toBe("form");
    expect(result.decision.user.disclosure).toBe("specific");
    expect(result.payload.details).toEqual({
      fieldErrors: {
        email: ["이메일 형식을 확인해주세요."],
        password: ["비밀번호는 8자 이상이어야 합니다."],
      },
    });
  });

  it("the handler runs with parsed input on success", async () => {
    const result = await signupAction({ email: "user@example.com", password: "longenough" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({ id: "u_1", email: "user@example.com" });
  });
});

describe("boundary precedence (finding #6 / T2)", () => {
  it("boundary defaults win over operation defaults, call-site overrides win over both", () => {
    // product.read declares defaultUiScope: "page" and criticality: "core".
    const boundary = decisionSystem.makeOccurrence("product.read", {
      interaction: "query",
      uiScope: "component",
    });
    expect(boundary.uiScope).toBe("component"); // boundary default beats operation default "page"
    expect(boundary.criticality).toBe("core"); // unset boundary criticality falls back to operation

    const override = decisionSystem.makeOccurrence(
      "product.read",
      { interaction: "query", uiScope: "component" },
      { uiScope: "panel" },
    );
    expect(override.uiScope).toBe("panel"); // call-site override beats the boundary default
  });
});

describe("sampling execution contract (finding #6 / T1)", () => {
  const base = {
    errors: DEMO_ERRORS,
    operations: DEMO_OPERATIONS,
    fallbackErrorCode: "UNKNOWN_SERVER_ERROR",
  } as const;
  const decision: TelemetryDecision = {
    capture: true,
    level: "warning",
    breadcrumb: true,
    alert: false,
    sampleRate: 0.1,
  };
  const ctx: TelemetryContext = { runtime: "client", operation: "profile.prefetch" };

  const run = (sampler: () => number) => {
    const system = createDecisionSystem({ ...base, sampler });
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
});

describe("boundary helpers fill the documented occurrence (finding #3)", () => {
  it("defineServerAction -> mutation/component", async () => {
    const action = decisionSystem.defineServerAction("checkout.pay", async () => {
      throw appError("UNKNOWN_SERVER_ERROR");
    });
    const result = await action({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.occurrence.interaction).toBe("mutation");
    expect(result.occurrence.uiScope).toBe("component");
  });

  it("defineRouteGuard -> route-guard/page", async () => {
    const guard = decisionSystem.defineRouteGuard("admin.users", async () => {
      throw appError("FORBIDDEN");
    });
    const result = await guard();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.occurrence.interaction).toBe("route-guard");
    expect(result.occurrence.uiScope).toBe("page");
  });

  it("withRenderBoundary -> render/page/core", async () => {
    const render = decisionSystem.withRenderBoundary("product.read", async () => {
      throw appError("SCHEMA_MISMATCH");
    });
    const result = await render();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.occurrence.interaction).toBe("render");
    expect(result.occurrence.uiScope).toBe("page");
    expect(result.occurrence.criticality).toBe("core");
  });
});

describe("registry invariant validation (finding #5)", () => {
  it("throws when an error can reach a disclosure level with no messageKey", () => {
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
      }),
    ).toThrow(/disclosure\/messageKey invariant/);
  });

  it("throws when fallbackErrorCode is absent from the catalog", () => {
    expect(() =>
      createDecisionSystem({ errors: {}, operations: {}, fallbackErrorCode: "MISSING" as never }),
    ).toThrow(/fallbackErrorCode/);
  });

  it("validateMessageKeys:false opts out of the invariant", () => {
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
});

describe("presentation executor does not reinterpret the decision (finding #3 / T5)", () => {
  const makeDecision = (user: Partial<ErrorDecision["user"]>): ErrorDecision => ({
    user: { surface: "inline", disclosure: "generic", messageKey: "error.unknown", action: "none", ...user },
    telemetry: { capture: false, level: "info", breadcrumb: false, alert: false },
  });

  it("renders nothing for a silent decision", () => {
    expect(ErrorSurface({ decision: makeDecision({ surface: "silent" }), translate })).toBeNull();
  });

  it("dispatches to the matching slot with the translated message and field errors", () => {
    const fieldSlot = vi.fn(() => null);
    ErrorSurface({
      decision: makeDecision({ surface: "field", messageKey: "error.validation", action: "fix-input" }),
      translate,
      slots: { field: fieldSlot },
      details: { fieldErrors: { email: ["x"] } },
    });
    expect(fieldSlot).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "입력값을 확인해주세요.",
        actionLabel: "입력 수정",
        fieldErrors: { email: ["x"] },
      }),
    );
  });
});

describe("executeErrorDecision runs telemetry and returns the user decision (finding #3)", () => {
  it("returns decision.user and forwards to the telemetry sinks", () => {
    const occurrence = decisionSystem.makeOccurrence("checkout.pay", {
      interaction: "form-submit",
      uiScope: "form",
    });
    const failure = decisionSystem.finalizeUnknown(appError("UNKNOWN_SERVER_ERROR"), occurrence, {
      runtime: "server",
    });
    const capture = vi.fn();
    const user = decisionSystem.executeErrorDecision(
      failure.error,
      failure.decision,
      { runtime: "server", operation: "checkout.pay" },
      { reporter: { capture, breadcrumb: vi.fn() }, notifier: { alert: vi.fn() } },
    );
    expect(user).toBe(failure.decision.user);
    expect(capture).toHaveBeenCalledTimes(1);
  });
});

describe("per-code details typing (B1)", () => {
  it("system.fail returns a typed draft for valid details", () => {
    const draft = decisionSystem.fail("VALIDATION", { fieldErrors: { email: ["bad"] } });
    expect(draft.code).toBe("VALIDATION");
    expect(draft.details).toEqual({ fieldErrors: { email: ["bad"] } });
  });

  it("rejects wrong details shapes and unknown codes at compile time", () => {
    // These lines must each be a type error; if any stops being one, `pnpm typecheck` fails
    // on the unused @ts-expect-error, which is exactly the regression guard we want.

    // @ts-expect-error INVALID_CREDENTIALS declares `null` details — an object is rejected.
    decisionSystem.fail("INVALID_CREDENTIALS", { passwordWasWrong: true });

    // @ts-expect-error VALIDATION requires fieldErrors-shaped details, not an arbitrary object.
    decisionSystem.fail("VALIDATION", { nope: 1 });

    // @ts-expect-error unknown code is not in the catalog.
    decisionSystem.fail("NOT_A_REAL_CODE", null);

    expect(true).toBe(true);
  });
});

describe("fieldPath/occurrence merge precedence (B3 footgun)", () => {
  it("fieldPath-driven uiScope:field is not clobbered by a conflicting occurrence.uiScope", () => {
    const occurrence = decisionSystem.makeOccurrence("auth.signup", {
      interaction: "form-submit",
      uiScope: "form",
    });
    const result = decisionSystem.finalizeFailure(
      fail("VALIDATION", { fieldErrors: { email: ["bad"] } }, { fieldPath: "email", occurrence: { uiScope: "page" } }),
      occurrence,
      { runtime: "server" },
    );
    expect(result.occurrence.uiScope).toBe("field");
    expect(result.occurrence.fieldPath).toBe("email");
    expect(result.decision.user.surface).toBe("field");
  });
});

describe("redirect target resolution (B2)", () => {
  it("AUTH_REQUIRED on a route guard resolves a redirect decision carrying the registry redirectTarget", () => {
    const occurrence = decisionSystem.makeOccurrence("admin.users", {
      interaction: "route-guard",
      uiScope: "page",
    });
    const result = decisionSystem.finalizeUnknown(appError("AUTH_REQUIRED"), occurrence, { runtime: "server" });
    expect(result.decision.user.surface).toBe("redirect");
    expect(result.decision.user.action).toBe("login");
    expect(result.decision.user.target).toBe("/login");
  });

  it("target means fieldPath for field surfaces and is undefined for plain form errors", async () => {
    const validation = await loginAction({ email: "bad" });
    expect(validation.ok).toBe(false);
    if (!validation.ok) expect(validation.decision.user.target).toBe("email");

    const creds = await loginAction({ email: "user@example.com" });
    expect(creds.ok).toBe(false);
    if (!creds.ok) expect(creds.decision.user.target).toBeUndefined();
  });
});

describe("scenario matrix snapshot (finding #6 / #7 — locks the published matrix)", () => {
  // Each row mirrors a documented row in ERROR_DECISION_SYSTEM.md "대표 시나리오".
  const rows: Array<{
    name: string;
    code: string;
    operation: Parameters<typeof decisionSystem.makeOccurrence>[0];
    boundary: Parameters<typeof decisionSystem.makeOccurrence>[1];
    overrides?: Parameters<typeof decisionSystem.makeOccurrence>[2];
    details?: unknown;
    runtime?: "server" | "client";
    correlationId?: string;
    expect: Partial<ErrorDecision["user"]> & { capture?: boolean; alert?: boolean };
  }> = [
    {
      name: "VALIDATION signup field",
      code: "VALIDATION",
      operation: "auth.signup",
      boundary: { interaction: "form-submit", uiScope: "form" },
      overrides: { uiScope: "field", fieldPath: "email" },
      details: { fieldErrors: { email: ["이메일 형식을 확인해주세요."] } },
      expect: { surface: "field", disclosure: "specific", action: "fix-input", capture: false },
    },
    {
      name: "INVALID_CREDENTIALS login form",
      code: "INVALID_CREDENTIALS",
      operation: "auth.login",
      boundary: { interaction: "form-submit", uiScope: "form" },
      expect: { surface: "form", disclosure: "safe-vague", action: "fix-input" },
    },
    {
      name: "AUTH_REQUIRED route guard",
      code: "AUTH_REQUIRED",
      operation: "admin.users",
      boundary: { interaction: "route-guard", uiScope: "page" },
      expect: { surface: "redirect", disclosure: "safe-vague", action: "login" },
    },
    {
      name: "FORBIDDEN admin page",
      code: "FORBIDDEN",
      operation: "admin.users",
      boundary: { interaction: "route-guard", uiScope: "page" },
      runtime: "server",
      expect: { surface: "page", disclosure: "safe-vague", action: "request-access", capture: true },
    },
    {
      name: "NOT_FOUND search collection",
      code: "NOT_FOUND",
      operation: "search.products",
      boundary: { interaction: "query", uiScope: "component" },
      overrides: { resource: "collection" },
      expect: { surface: "empty", disclosure: "specific", action: "none" },
    },
    {
      name: "NOT_FOUND product detail page",
      code: "NOT_FOUND",
      operation: "product.read",
      boundary: { interaction: "query", uiScope: "component" },
      overrides: { resource: "product" },
      expect: { surface: "page", disclosure: "safe-vague", action: "go-back" },
    },
    {
      name: "TIMEOUT checkout form",
      code: "TIMEOUT",
      operation: "checkout.pay",
      boundary: { interaction: "form-submit", uiScope: "form" },
      expect: { surface: "form", disclosure: "safe-vague", action: "retry" },
    },
    {
      name: "SCHEMA_MISMATCH product page",
      code: "SCHEMA_MISMATCH",
      operation: "product.read",
      boundary: { interaction: "query", uiScope: "page" },
      runtime: "server",
      correlationId: "corr-x",
      expect: { surface: "page", disclosure: "support-only", action: "contact-support", capture: true, alert: true },
    },
    {
      name: "UNKNOWN_SERVER_ERROR checkout submit",
      code: "UNKNOWN_SERVER_ERROR",
      operation: "checkout.pay",
      boundary: { interaction: "form-submit", uiScope: "form" },
      runtime: "server",
      expect: { surface: "form", disclosure: "support-only", action: "contact-support", capture: true, alert: true },
    },
  ];

  it.each(rows)("$name", (row) => {
    const occurrence = decisionSystem.makeOccurrence(row.operation, row.boundary, row.overrides);
    const result = decisionSystem.finalizeUnknown(appError(row.code, row.details ?? null), occurrence, {
      runtime: row.runtime ?? "client",
      correlationId: row.correlationId,
    });
    const { capture, alert, ...user } = row.expect;
    expect(result.decision.user).toMatchObject(user);
    if (capture !== undefined) expect(result.decision.telemetry.capture).toBe(capture);
    if (alert !== undefined) expect(result.decision.telemetry.alert).toBe(alert);
  });
});
