// P3b-ii — createHandleError is now a thin DELEGATE over a DecisionSystem.
//
// createHandleError(system, sinks, baseCtx, baseOccurrence) returns a function that, given
// any caught input:
//   (1) finalizes via system.finalizeUnknown → a DecisionFailure { error, decision, payload, occurrence },
//   (2) applies an optional options.telemetry override onto decision.telemetry (5% escape hatch),
//   (3) runs system.executeErrorDecision → telemetry fan-out (capture → breadcrumb → alert),
//   (4) returns the DecisionFailure.
//
// The engine behavior (resolve/finalize/executeTelemetry) is covered by decision-system.test.ts;
// here we verify ONLY the delegation wiring: that the returned failure is the system's, and that
// the sinks are driven by decision.telemetry's booleans (incl. the override), guarded from throws.
import { describe, it, expect, vi } from "vitest";

import { createHandleError } from "@/error/handle-error";
import { createDecisionSystem } from "@/error/decision/system";
import { CANONICAL_ERROR_SEMANTICS } from "@/error/decision/catalog";
import { appError } from "@/error/decision/app-error";
import type {
  ReporterSink,
  NotifierSink,
  TelemetryContext,
  OccurrenceContext,
} from "@/error/decision/types";

const OPERATIONS = {
  "product.read": {
    operation: "product.read",
    owner: "catalog",
    criticality: "core",
    defaultUiScope: "page",
    piiRisk: false,
  },
} as const;

const makeSystem = () =>
  createDecisionSystem({
    errors: CANONICAL_ERROR_SEMANTICS,
    operations: OPERATIONS,
    fallbackErrorCode: "UNKNOWN_SERVER_ERROR",
    defaultRuntime: "server",
  });

const BASE_CTX: TelemetryContext = {
  runtime: "server",
  operation: "product.read",
  correlationId: "c",
  user: null,
};

const BASE_OCCURRENCE: OccurrenceContext = {
  operation: "product.read",
  interaction: "query",
  uiScope: "page",
  criticality: "core",
};

const makeSinks = () => {
  const reporter: ReporterSink = { capture: vi.fn(), breadcrumb: vi.fn() };
  const notifier: NotifierSink = { alert: vi.fn() };
  return { reporter, notifier };
};

describe("createHandleError — decision-system delegate (P3b-ii)", () => {
  it("returns the system's DecisionFailure { error, decision, payload, occurrence }", () => {
    const system = makeSystem();
    const sinks = makeSinks();
    const handle = createHandleError(system, sinks, BASE_CTX, BASE_OCCURRENCE);

    const failure = handle(appError("HTTP_SERVER_ERROR", { status: 500 }));

    expect(failure.ok).toBe(false);
    expect(failure.error.code).toBe("HTTP_SERVER_ERROR");
    expect(failure.decision).toBeDefined();
    expect(failure.payload.code).toBe("HTTP_SERVER_ERROR");
    expect(failure.occurrence.operation).toBe("product.read");
  });

  it("wraps a non-AppError into the fallback code via finalizeUnknown", () => {
    const system = makeSystem();
    const sinks = makeSinks();
    const handle = createHandleError(system, sinks, BASE_CTX, BASE_OCCURRENCE);

    const failure = handle(new TypeError("boom"));

    expect(failure.error.code).toBe("UNKNOWN_SERVER_ERROR");
    // no raw message leaks into the wire payload.
    expect(JSON.stringify(failure.payload)).not.toContain("boom");
  });

  it("drives the sinks exactly per decision.telemetry (capture → breadcrumb → alert)", () => {
    const system = makeSystem();
    const sinks = makeSinks();
    const handle = createHandleError(system, sinks, BASE_CTX, BASE_OCCURRENCE);

    // UNKNOWN_SERVER_ERROR (fault) resolves capture:true, breadcrumb:true; alert depends on criticality.
    const failure = handle(appError("UNKNOWN_SERVER_ERROR"));
    const t = failure.decision.telemetry;

    expect((sinks.reporter.capture as ReturnType<typeof vi.fn>).mock.calls.length).toBe(t.capture ? 1 : 0);
    expect((sinks.reporter.breadcrumb as ReturnType<typeof vi.fn>).mock.calls.length).toBe(t.breadcrumb ? 1 : 0);
    expect((sinks.notifier.alert as ReturnType<typeof vi.fn>).mock.calls.length).toBe(t.alert ? 1 : 0);
  });

  it("capture/breadcrumb/alert receive the finalized error + decision.telemetry + ctx", () => {
    const system = makeSystem();
    const sinks = makeSinks();
    const handle = createHandleError(system, sinks, BASE_CTX, BASE_OCCURRENCE);

    const failure = handle(appError("UNKNOWN_SERVER_ERROR"));

    const [capErr, capDecision, capCtx] = (sinks.reporter.capture as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(capErr).toBe(failure.error);
    expect(capDecision).toBe(failure.decision.telemetry);
    expect(capCtx.correlationId).toBe("c");
    expect(capCtx.operation).toBe("product.read");
  });

  it("options.telemetry overrides the resolved telemetry (escape hatch) and gates the sinks", () => {
    const system = makeSystem();
    const sinks = makeSinks();
    const handle = createHandleError(system, sinks, BASE_CTX, BASE_OCCURRENCE);

    // Force capture off, alert on — the sinks must follow the OVERRIDDEN decision.
    const failure = handle(appError("UNKNOWN_SERVER_ERROR"), {
      telemetry: { capture: false, alert: true },
    });

    expect(failure.decision.telemetry.capture).toBe(false);
    expect(failure.decision.telemetry.alert).toBe(true);
    expect(sinks.reporter.capture).not.toHaveBeenCalled();
    expect(sinks.notifier.alert).toHaveBeenCalledTimes(1);
  });

  it("isolates sink failures so error handling never throws back into the app (guardSink)", () => {
    const system = makeSystem();
    const reporter: ReporterSink = {
      capture: vi.fn(() => {
        throw new Error("capture failed");
      }),
      breadcrumb: vi.fn(() => {
        throw new Error("breadcrumb failed");
      }),
    };
    const notifier: NotifierSink = {
      alert: vi.fn(() => {
        throw new Error("alert failed");
      }),
    };
    const handle = createHandleError(system, { reporter, notifier }, BASE_CTX, BASE_OCCURRENCE);

    let failure: ReturnType<typeof handle> | undefined;
    expect(() => {
      failure = handle(appError("UNKNOWN_SERVER_ERROR", null, { correlationId: "c" }));
    }).not.toThrow();
    // The failure is still returned even though the first sink threw.
    expect(failure?.error.code).toBe("UNKNOWN_SERVER_ERROR");
  });

  it("merges options.ctx over baseCtx and threads it into the sinks", () => {
    const system = makeSystem();
    const sinks = makeSinks();
    const handle = createHandleError(system, sinks, BASE_CTX, BASE_OCCURRENCE);

    handle(appError("UNKNOWN_SERVER_ERROR"), {
      telemetry: { capture: true },
      ctx: { route: "/checkout", correlationId: "override-id" },
    });

    const capCtx = (sinks.reporter.capture as ReturnType<typeof vi.fn>).mock.calls[0]![2];
    expect(capCtx.correlationId).toBe("override-id");
    expect(capCtx.route).toBe("/checkout");
    expect(capCtx.runtime).toBe("server");
  });

  it("merges options.occurrence over the base occurrence", () => {
    const system = makeSystem();
    const sinks = makeSinks();
    const handle = createHandleError(system, sinks, BASE_CTX, BASE_OCCURRENCE);

    const failure = handle(appError("VALIDATION", { fieldErrors: { email: ["bad"] } }), {
      occurrence: { uiScope: "field", fieldPath: "email" },
    });

    expect(failure.occurrence.uiScope).toBe("field");
    expect(failure.occurrence.fieldPath).toBe("email");
  });
});
