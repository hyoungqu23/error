import { describe, expect, it, vi } from "vitest";
import {
  decisionSystem,
  loginAction,
  checkoutAction,
  productQuery,
  searchProducts,
  backgroundPrefetch,
  adminPage,
} from "../demo";
import { appError, fail } from "../index";

describe("Error Decision System", () => {
  it("VALIDATION + field becomes a specific field decision without capture", async () => {
    const result = await loginAction({ email: "bad" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.decision.user.surface).toBe("field");
    expect(result.decision.user.disclosure).toBe("specific");
    expect(result.decision.telemetry.capture).toBe(false);
    expect(result.payload.details).toEqual({
      fieldErrors: { email: ["이메일 형식을 확인해주세요."] },
      field: "email",
    });
  });

  it("INVALID_CREDENTIALS stays safe-vague and does not leak details", async () => {
    const result = await loginAction({ email: "user@example.com" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.decision.user.surface).toBe("form");
    expect(result.decision.user.disclosure).toBe("safe-vague");
    expect(result.decision.user.messageKey).toBe("error.invalidCredentials.safe");
    expect(result.payload.details).toBeUndefined();
  });

  it("checkout payment failure is revenue-critical warning telemetry", async () => {
    const result = await checkoutAction({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.occurrence.criticality).toBe("revenue");
    expect(result.decision.telemetry.capture).toBe(true);
    expect(result.decision.telemetry.level).toBe("warning");
    expect(result.payload.details).toEqual({ providerCode: "PENDING_CONFIRMATION" });
  });

  it("schema mismatch on a core page becomes support-only fatal alert candidate on server", () => {
    const occurrence = decisionSystem.makeOccurrence("product.read", {
      interaction: "query",
      uiScope: "page",
      criticality: "core",
    });
    const result = decisionSystem.finalizeUnknown(appError("SCHEMA_MISMATCH"), occurrence, {
      runtime: "server",
      correlationId: "corr-1",
    });
    expect(result.decision.user.disclosure).toBe("support-only");
    expect(result.decision.user.supportCode).toBe("corr-1");
    expect(result.decision.telemetry.capture).toBe(true);
    expect(result.decision.telemetry.alert).toBe(true);
  });

  it("background prefetch is silent and sampled", async () => {
    const result = await backgroundPrefetch();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.decision.user.surface).toBe("silent");
    expect(result.decision.telemetry.sampleRate).toBe(0.1);
  });

  it("protected admin page maps forbidden to page-level request-access", async () => {
    const result = await adminPage();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.decision.user.surface).toBe("page");
    expect(result.decision.user.action).toBe("request-access");
    expect(result.decision.telemetry.capture).toBe(true);
  });

  it("query wrapper returns success or decision failures without forcing a page crash", async () => {
    const success = await productQuery({ id: "book" });
    expect(success.ok).toBe(true);
    const failure = await productQuery({ id: "missing" });
    expect(failure.ok).toBe(false);
    if (failure.ok) return;
    expect(failure.decision.user.action).toBe("go-back");
    expect(failure.decision.user.surface).toBe("page");
    expect(failure.decision.user.disclosure).toBe("safe-vague");
  });

  it("search not found maps to empty state without code branching in UI", async () => {
    const failure = await searchProducts({ query: "empty" });
    expect(failure.ok).toBe(false);
    if (failure.ok) return;
    expect(failure.decision.user.surface).toBe("empty");
    expect(failure.decision.user.action).toBe("none");
    expect(failure.decision.user.disclosure).toBe("specific");
  });

  it("escape hatch can override telemetry without bypassing decision execution", () => {
    const occurrence = decisionSystem.makeOccurrence("checkout.pay", {
      interaction: "form-submit",
      uiScope: "form",
    });
    const result = decisionSystem.finalizeFailure(
      fail("PAYMENT_FAILED", null, {
        telemetry: { alert: false, fingerprint: ["checkout.pay", "manual"] },
      }),
      occurrence,
      { runtime: "server" },
    );
    expect(result.decision.telemetry.alert).toBe(false);
    expect(result.decision.telemetry.fingerprint).toEqual(["checkout.pay", "manual"]);
  });

  it("details schema failure falls back to a safe fault", () => {
    const occurrence = decisionSystem.makeOccurrence("auth.signup", {
      interaction: "form-submit",
      uiScope: "form",
    });
    const result = decisionSystem.finalizeFailure(fail("VALIDATION", { unsafe: true }), occurrence, {
      runtime: "server",
      correlationId: "corr-schema",
    });
    expect(result.error.code).toBe("UNKNOWN_SERVER_ERROR");
    expect(result.payload.details).toBeUndefined();
    expect(result.decision.user.supportCode).toBe("corr-schema");
  });

  it("client payload never exposes raw Error.message or non-allowlisted details", () => {
    const occurrence = decisionSystem.makeOccurrence("product.read", {
      interaction: "query",
      uiScope: "page",
      criticality: "core",
    });
    const result = decisionSystem.finalizeUnknown(
      appError("SCHEMA_MISMATCH", { dbPassword: "secret" }, { message: "db password leaked" }),
      occurrence,
      { runtime: "server", correlationId: "corr-raw" },
    );
    expect(JSON.stringify(result.payload)).not.toContain("db password leaked");
    expect(JSON.stringify(result.payload)).not.toContain("secret");
    expect(result.payload.supportCode).toBe("corr-raw");
  });

  it("operation names are runtime-validated when no typed union is available", () => {
    expect(() =>
      decisionSystem.makeOccurrence("unknown.operation" as never, {
        interaction: "query",
        uiScope: "component",
      }),
    ).toThrow("Unknown operation");
  });

  it("telemetry executor obeys the decision booleans without reinterpreting severity", () => {
    const occurrence = decisionSystem.makeOccurrence("checkout.pay", {
      interaction: "form-submit",
      uiScope: "form",
    });
    const result = decisionSystem.finalizeUnknown(appError("UNKNOWN_SERVER_ERROR"), occurrence, {
      runtime: "server",
    });
    const capture = vi.fn();
    const breadcrumb = vi.fn();
    const alert = vi.fn();
    decisionSystem.executeTelemetryDecision(
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
