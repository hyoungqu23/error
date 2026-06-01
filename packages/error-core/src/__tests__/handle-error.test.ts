import { describe, it, expect, vi, beforeEach } from "vitest";

import { createHandleError } from "@/error/handle-error";
import type { HandleErrorDeps } from "@/error/types";
import type { TelemetryContext, Reporter, Presenter } from "@/error/telemetry";
import type { Notifier } from "@/error/notifier";
import { thresholdAlertPolicy, policyGatedNotifier } from "@/error/notifier";
import { DEFAULT_ERROR_REGISTRY } from "@/error/registry";
import { runWithErrorRegistry } from "@/error/active-registry";
import { makeError } from "@/error/make-error";
import { isDomainError } from "@/error/app-error";

// §10 — handleError side effects (r5 step gating).
//
// createHandleError(deps, baseCtx) returns a function that, given any caught input,
// (1) normalizes to a DomainError, (2) resolves the full policy off the INJECTED
// registry, then fans out in a FIXED order:
//   (1) reporter.report          — unless the resolved log is "none"
//   (2) notifier.notify          — ALWAYS (the alert gate lives inside the notifier)
//   (3) presenter.present        — ONLY for "toast"/"alert" (Presenter-actionable)
//   (4) reporter.breadcrumb      — T1 impact breadcrumb, unless present === "silent",
//                                  INDEPENDENT of log
// …then returns ResolvedAppError. (r5 renamed ux→present; the old "none" is split
// into "inline" (business-inline) vs "silent" (truly-silent like REQUEST_ABORTED).)

const BASE_CTX: TelemetryContext = { runtime: "server", correlationId: "c", user: null };

const makeReporter = () => ({
  report: vi.fn(),
  breadcrumb: vi.fn(),
  setUser: vi.fn(),
  setContext: vi.fn(),
}) satisfies Reporter;

const makePresenter = () => ({ present: vi.fn() }) satisfies Presenter;

const makeDeps = (notifier: Notifier) => {
  const reporter = makeReporter();
  const presenter = makePresenter();
  const deps: HandleErrorDeps = {
    registry: DEFAULT_ERROR_REGISTRY,
    reporter,
    presenter,
    notifier,
  };
  return { deps, reporter, presenter };
};

// Run inside the server registry scope so the DomainError getters (severity/log/present)
// resolve against DEFAULT_ERROR_REGISTRY deterministically.
const inScope = <R>(work: () => R): R => runWithErrorRegistry(DEFAULT_ERROR_REGISTRY, work);

describe("§10 createHandleError side effects", () => {
  let notifySpy: ReturnType<typeof vi.fn>;
  let notifier: Notifier;

  beforeEach(() => {
    notifySpy = vi.fn();
    notifier = { notify: notifySpy };
  });

  it("returns a ResolvedAppError { error, code, policy } with the resolved policy", () => {
    const { deps } = makeDeps(notifier);
    const handle = createHandleError(deps, BASE_CTX);

    const result = inScope(() =>
      handle(makeError({ code: "HTTP_SERVER_ERROR", details: { status: 500 } })),
    );

    expect(isDomainError(result.error, "HTTP_SERVER_ERROR")).toBe(true);
    expect(result.code).toBe("HTTP_SERVER_ERROR");
    // policy is the full resolved bundle off the injected registry. r5: `ux` → `present`;
    // `expected`/`isOperational` are DERIVED from kind (HTTP_SERVER_ERROR is kind:fault →
    // expected:false, isOperational:false).
    expect(result.policy).toMatchObject({
      severity: "error",
      present: "toast",
      log: "error",
      httpStatus: 500,
      retryable: true,
      expected: false,
      isOperational: false,
      userMessageKey: "error.httpServer",
    });
  });

  it("default options → reporter.report called exactly once with resolved level + threaded ctx", () => {
    const { deps, reporter } = makeDeps(notifier);
    const handle = createHandleError(deps, BASE_CTX);

    const error = makeError({ code: "HTTP_SERVER_ERROR", details: { status: 500 } });
    const result = inScope(() => handle(error));

    expect(reporter.report).toHaveBeenCalledTimes(1);
    const [reportedError, level, ctx] = reporter.report.mock.calls[0]!;
    // resolved level == the registry log level for the code.
    expect(level).toBe("error");
    expect(level).toBe(result.policy.log);
    expect(isDomainError(reportedError, "HTTP_SERVER_ERROR")).toBe(true);
    // correlationId from baseCtx is threaded into the report ctx.
    expect(ctx.correlationId).toBe("c");
    expect(ctx.runtime).toBe("server");
  });

  it("isolates sink failures so error handling never throws back into the app", () => {
    const reporter: Reporter = {
      report: vi.fn(() => {
        throw new Error("report failed");
      }),
      breadcrumb: vi.fn(() => {
        throw new Error("breadcrumb failed");
      }),
      setUser: vi.fn(),
      setContext: vi.fn(),
    };
    const presenter: Presenter = {
      present: vi.fn(() => {
        throw new Error("present failed");
      }),
    };
    const throwingNotifier: Notifier = {
      notify: vi.fn(() => {
        throw new Error("notify failed");
      }),
    };
    const deps: HandleErrorDeps = {
      registry: DEFAULT_ERROR_REGISTRY,
      reporter,
      presenter,
      notifier: throwingNotifier,
    };
    const handle = createHandleError(deps, BASE_CTX);

    expect(() =>
      inScope(() => handle(makeError({ code: "HTTP_SERVER_ERROR", details: { status: 500 } }))),
    ).not.toThrow();

    expect(reporter.report).toHaveBeenCalledTimes(1);
    expect(throwingNotifier.notify).toHaveBeenCalledTimes(1);
    expect(presenter.present).toHaveBeenCalledTimes(1);
    expect(reporter.breadcrumb).toHaveBeenCalledTimes(1);
  });

  it("options.log:'none' → reporter.report is NOT called (presenter/notifier/breadcrumb still fire)", () => {
    const { deps, reporter, presenter } = makeDeps(notifier);
    const handle = createHandleError(deps, BASE_CTX);

    inScope(() =>
      handle(makeError({ code: "HTTP_SERVER_ERROR", details: { status: 500 } }), {
        log: "none",
      }),
    );

    expect(reporter.report).not.toHaveBeenCalled();
    // log:"none" suppresses ONLY the reporter.report capture — the other sinks are
    // independent. The T1 impact breadcrumb is keyed off `present`, not `log`, so it
    // STILL fires (present="toast" ≠ "silent").
    expect(presenter.present).toHaveBeenCalledTimes(1);
    expect(notifySpy).toHaveBeenCalledTimes(1);
    expect(reporter.breadcrumb).toHaveBeenCalledTimes(1);
  });

  it("a code whose registry log is 'none' → reporter.report is NOT called by default", () => {
    // NOT_FOUND has log:"none" in the registry; default path must skip the reporter.
    const { deps, reporter } = makeDeps(notifier);
    const handle = createHandleError(deps, BASE_CTX);

    inScope(() => handle(makeError({ code: "NOT_FOUND", details: null })));

    expect(reporter.report).not.toHaveBeenCalled();
  });

  it("options.present:'silent' → NO presenter AND NO breadcrumb (reporter still fires)", () => {
    // The truly-silent surface: handleError still captures (report) and alerts (notify),
    // but the Presenter is skipped (silent ∉ {toast,alert}) AND the T1 breadcrumb is
    // skipped (present === "silent" is the one case that suppresses the breadcrumb).
    const { deps, reporter, presenter } = makeDeps(notifier);
    const handle = createHandleError(deps, BASE_CTX);

    inScope(() =>
      handle(makeError({ code: "HTTP_SERVER_ERROR", details: { status: 500 } }), {
        present: "silent",
      }),
    );

    expect(presenter.present).not.toHaveBeenCalled();
    expect(reporter.breadcrumb).not.toHaveBeenCalled();
    // report + notify are independent of `present` and still fire.
    expect(reporter.report).toHaveBeenCalledTimes(1);
    expect(notifySpy).toHaveBeenCalledTimes(1);
  });

  it("options.present:'inline' → NO presenter, but breadcrumb DOES fire", () => {
    // The business-inline surface: not Presenter-actionable (inline ∉ {toast,alert}),
    // so present() is skipped — but the user DID see an impact (inline field error),
    // so the T1 breadcrumb is recorded (present !== "silent").
    const { deps, reporter, presenter } = makeDeps(notifier);
    const handle = createHandleError(deps, BASE_CTX);

    inScope(() =>
      handle(makeError({ code: "HTTP_SERVER_ERROR", details: { status: 500 } }), {
        present: "inline",
      }),
    );

    expect(presenter.present).not.toHaveBeenCalled();
    expect(reporter.breadcrumb).toHaveBeenCalledTimes(1);
    const [bcError, surface, bcCtx] = reporter.breadcrumb.mock.calls[0]!;
    // breadcrumb records the resolved surface the user experienced + threaded ctx.
    expect(surface).toBe("inline");
    expect(isDomainError(bcError, "HTTP_SERVER_ERROR")).toBe(true);
    expect(bcCtx.correlationId).toBe("c");
  });

  it.each(["redirect", "page"] as const)(
    "options.present:'%s' → NOT Presenter-handled, but breadcrumb fires (client escalates)",
    (surface) => {
      // redirect/page are escalated by the client useErrorHandler, not the Presenter,
      // so present() never fires; the breadcrumb still records the impact.
      const { deps, reporter, presenter } = makeDeps(notifier);
      const handle = createHandleError(deps, BASE_CTX);

      inScope(() =>
        handle(makeError({ code: "HTTP_SERVER_ERROR", details: { status: 500 } }), {
          present: surface,
        }),
      );

      expect(presenter.present).not.toHaveBeenCalled();
      expect(reporter.breadcrumb).toHaveBeenCalledTimes(1);
      expect(reporter.breadcrumb.mock.calls[0]![1]).toBe(surface);
    },
  );

  it("default present (toast) → presenter.present AND breadcrumb both fire once, in that order", () => {
    const { deps, reporter, presenter } = makeDeps(notifier);
    const handle = createHandleError(deps, BASE_CTX);

    const result = inScope(() =>
      handle(makeError({ code: "HTTP_SERVER_ERROR", details: { status: 500 } })),
    );

    // (3) presenter fires for toast with the resolved action + threaded ctx.
    expect(presenter.present).toHaveBeenCalledTimes(1);
    const [, action, presentCtx] = presenter.present.mock.calls[0]!;
    expect(action).toBe("toast");
    expect(action).toBe(result.policy.present);
    expect(presentCtx.correlationId).toBe("c");

    // (4) breadcrumb fires for the same toast surface (present !== "silent").
    expect(reporter.breadcrumb).toHaveBeenCalledTimes(1);
    expect(reporter.breadcrumb.mock.calls[0]![1]).toBe("toast");

    // Order invariant: present() (step 3) runs before breadcrumb() (step 4).
    expect(presenter.present.mock.invocationCallOrder[0]!).toBeLessThan(
      reporter.breadcrumb.mock.invocationCallOrder[0]!,
    );
  });

  it("a registry-silent code (REQUEST_ABORTED) → no presenter, no breadcrumb by default", () => {
    // REQUEST_ABORTED resolves present:"silent" in the registry; the default path
    // must skip BOTH the Presenter and the impact breadcrumb without any override.
    const { deps, reporter, presenter } = makeDeps(notifier);
    const handle = createHandleError(deps, BASE_CTX);

    const result = inScope(() => handle(makeError({ code: "REQUEST_ABORTED", details: null })));

    expect(result.policy.present).toBe("silent");
    expect(presenter.present).not.toHaveBeenCalled();
    expect(reporter.breadcrumb).not.toHaveBeenCalled();
  });

  it("a registry-inline business code (NOT_FOUND) → no presenter, breadcrumb fires", () => {
    // NOT_FOUND resolves present:"inline" (kind:business). Default path: no Presenter,
    // but the inline impact IS breadcrumbed.
    const { deps, reporter, presenter } = makeDeps(notifier);
    const handle = createHandleError(deps, BASE_CTX);

    const result = inScope(() => handle(makeError({ code: "NOT_FOUND", details: null })));

    expect(result.policy.present).toBe("inline");
    expect(presenter.present).not.toHaveBeenCalled();
    expect(reporter.breadcrumb).toHaveBeenCalledTimes(1);
    expect(reporter.breadcrumb.mock.calls[0]![1]).toBe("inline");
  });

  it("notifier.notify is ALWAYS called by handleError (the gate lives in the notifier)", () => {
    // Even for an info-severity code, handleError calls notify; gating is the
    // notifier's job, not handleError's.
    const { deps } = makeDeps(notifier);
    const handle = createHandleError(deps, BASE_CTX);

    const result = inScope(() => handle(makeError({ code: "NOT_FOUND", details: null })));

    expect(notifySpy).toHaveBeenCalledTimes(1);
    const [, severity, ctx] = notifySpy.mock.calls[0]!;
    // notify receives the resolved severity + threaded ctx.
    expect(severity).toBe("info");
    expect(severity).toBe(result.policy.severity);
    expect(ctx.correlationId).toBe("c");
  });

  describe("alert gating via policyGatedNotifier(thresholdAlertPolicy())", () => {
    // The real gate: a threshold policy (default "fatal") wrapping a delivery sink.
    // handleError always calls .notify(); the gate decides whether delivery fires.
    it("pages a delivery sink for a fatal-severity code", () => {
      const delivery = vi.fn();
      const gated = policyGatedNotifier(thresholdAlertPolicy(), { notify: delivery });
      const { deps } = makeDeps(gated);
      const handle = createHandleError(deps, BASE_CTX);

      const result = inScope(() => handle(makeError({ code: "UNKNOWN_SERVER_ERROR", details: null })));

      expect(result.policy.severity).toBe("fatal");
      expect(delivery).toHaveBeenCalledTimes(1);
      const [, severity, ctx] = delivery.mock.calls[0]!;
      expect(severity).toBe("fatal");
      expect(ctx.correlationId).toBe("c");
    });

    it("does NOT page the delivery sink for an info-severity code", () => {
      const delivery = vi.fn();
      const gated = policyGatedNotifier(thresholdAlertPolicy(), { notify: delivery });
      const { deps } = makeDeps(gated);
      const handle = createHandleError(deps, BASE_CTX);

      const result = inScope(() => handle(makeError({ code: "NOT_FOUND", details: null })));

      expect(result.policy.severity).toBe("info");
      expect(delivery).not.toHaveBeenCalled();
    });
  });

  it("options.ctx is merged over baseCtx and threaded into every sink", () => {
    const delivery = vi.fn();
    const gated = policyGatedNotifier(thresholdAlertPolicy(), { notify: delivery });
    const { deps, reporter, presenter } = makeDeps(gated);
    const handle = createHandleError(deps, BASE_CTX);

    inScope(() =>
      handle(makeError({ code: "UNKNOWN_SERVER_ERROR", details: null }), {
        ctx: { route: "/checkout", correlationId: "override-id" },
      }),
    );

    const reportCtx = reporter.report.mock.calls[0]![2] as TelemetryContext;
    const presentCtx = presenter.present.mock.calls[0]![2] as TelemetryContext;
    const deliveryCtx = delivery.mock.calls[0]![2] as TelemetryContext;
    // UNKNOWN_SERVER_ERROR resolves present:"toast" → the breadcrumb fires too; its ctx
    // (the impact key) is threaded identically.
    const breadcrumbCtx = reporter.breadcrumb.mock.calls[0]![2] as TelemetryContext;

    for (const ctx of [reportCtx, presentCtx, deliveryCtx, breadcrumbCtx]) {
      // per-call ctx wins; baseCtx fields preserved when not overridden.
      expect(ctx.correlationId).toBe("override-id");
      expect(ctx.route).toBe("/checkout");
      expect(ctx.runtime).toBe("server");
    }
  });
});
