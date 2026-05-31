// t-new — handle-error.ts T1 IMPACT BREADCRUMB (the r5 gating behavior change).
//
// After the three sinks, handleError records the user-visible IMPACT via
// reporter.breadcrumb(error, surface, ctx) WITHOUT a re-capture:
//   - keyed by ctx.correlationId,
//   - INDEPENDENT of the log level (fires even when log === "none"),
//   - surface === the resolved PresentAction the user actually experienced,
//   - SKIPPED only when the surface is "silent",
//   - the PRESENTER fires only for "toast"/"alert" (redirect/page/inline/silent do not).
import { describe, it, expect, vi, beforeEach } from "vitest";

import { createHandleError } from "@/error/handle-error";
import type { HandleErrorDeps } from "@/error/types";
import type { TelemetryContext, Reporter, Presenter } from "@/error/telemetry";
import type { Notifier } from "@/error/notifier";
import { DEFAULT_ERROR_REGISTRY } from "@/error/registry";
import { runWithErrorRegistry } from "@/error/active-registry";
import { makeError } from "@/error/make-error";
import { isDomainError } from "@/error/app-error";

const BASE_CTX: TelemetryContext = { runtime: "server", correlationId: "corr-xyz", user: null };

const makeReporter = () =>
  ({
    report: vi.fn(),
    breadcrumb: vi.fn(),
    setUser: vi.fn(),
    setContext: vi.fn(),
  }) satisfies Reporter;

const makeDeps = () => {
  const reporter = makeReporter();
  const presenter: Presenter = { present: vi.fn() };
  const notifier: Notifier = { notify: vi.fn() };
  const deps: HandleErrorDeps = {
    registry: DEFAULT_ERROR_REGISTRY,
    reporter,
    presenter,
    notifier,
  };
  return { deps, reporter, presenter, notifier };
};

// Bind the server registry scope so the getters resolve against DEFAULT deterministically.
const inScope = <R>(work: () => R): R => runWithErrorRegistry(DEFAULT_ERROR_REGISTRY, work);

describe("T1 impact breadcrumb (r5 gating)", () => {
  let env: ReturnType<typeof makeDeps>;
  let handle: ReturnType<typeof createHandleError>;

  beforeEach(() => {
    env = makeDeps();
    handle = createHandleError(env.deps, BASE_CTX);
  });

  it("records the resolved surface keyed by correlationId for a toast code", () => {
    // NETWORK_ERROR → present "toast".
    const result = inScope(() => handle(makeError({ code: "NETWORK_ERROR", details: null })));

    expect(env.reporter.breadcrumb).toHaveBeenCalledTimes(1);
    const [bcError, surface, ctx] = env.reporter.breadcrumb.mock.calls[0]!;
    expect(isDomainError(bcError, "NETWORK_ERROR")).toBe(true);
    // surface is the resolved PresentAction the user experienced.
    expect(surface).toBe("toast");
    expect(surface).toBe(result.policy.present);
    // keyed by ctx.correlationId from baseCtx.
    expect(ctx.correlationId).toBe("corr-xyz");
  });

  it("fires the breadcrumb even when log === 'none' (independent of log)", () => {
    inScope(() =>
      handle(makeError({ code: "HTTP_SERVER_ERROR", details: { status: 500 } }), {
        log: "none",
      }),
    );

    // log:"none" suppresses the reporter.report capture …
    expect(env.reporter.report).not.toHaveBeenCalled();
    // … but the impact breadcrumb is independent of log and still fires.
    expect(env.reporter.breadcrumb).toHaveBeenCalledTimes(1);
    expect(env.reporter.breadcrumb.mock.calls[0]![1]).toBe("toast");
  });

  it("does NOT re-capture: breadcrumb is recorded without calling reporter.report again", () => {
    // VALIDATION → present "inline", log "none". No report, but a breadcrumb for the inline impact.
    inScope(() => handle(makeError({ code: "VALIDATION", details: { fieldErrors: {} } })));

    expect(env.reporter.report).not.toHaveBeenCalled();
    expect(env.reporter.breadcrumb).toHaveBeenCalledTimes(1);
    expect(env.reporter.breadcrumb.mock.calls[0]![1]).toBe("inline");
    // inline is NOT a Presenter surface.
    expect(env.presenter.present).not.toHaveBeenCalled();
  });

  it("SKIPS the breadcrumb for a truly-silent surface (REQUEST_ABORTED)", () => {
    // REQUEST_ABORTED → present "silent": no presenter AND no breadcrumb.
    inScope(() => handle(makeError({ code: "REQUEST_ABORTED", details: null })));

    expect(env.reporter.breadcrumb).not.toHaveBeenCalled();
    expect(env.presenter.present).not.toHaveBeenCalled();
  });

  it("a per-call present override drives BOTH the surface recorded and the silent skip", () => {
    // Override a toast code to "silent" → breadcrumb skipped.
    inScope(() =>
      handle(makeError({ code: "NETWORK_ERROR", details: null }), { present: "silent" }),
    );
    expect(env.reporter.breadcrumb).not.toHaveBeenCalled();

    // Override an inline code to "redirect" → breadcrumb records "redirect" (not a Presenter surface).
    inScope(() =>
      handle(makeError({ code: "VALIDATION", details: { fieldErrors: {} } }), {
        present: "redirect",
      }),
    );
    expect(env.reporter.breadcrumb).toHaveBeenCalledTimes(1);
    expect(env.reporter.breadcrumb.mock.calls[0]![1]).toBe("redirect");
    expect(env.presenter.present).not.toHaveBeenCalled();
  });

  it("the presenter fires only for toast/alert, while the breadcrumb still records redirect/page", () => {
    // FORBIDDEN → present "page": presenter NOT called, breadcrumb records "page".
    inScope(() => handle(makeError({ code: "FORBIDDEN", details: { requiredRole: "admin" } })));
    expect(env.presenter.present).not.toHaveBeenCalled();
    expect(env.reporter.breadcrumb).toHaveBeenCalledTimes(1);
    expect(env.reporter.breadcrumb.mock.calls[0]![1]).toBe("page");

    // AUTH_REQUIRED → present "redirect": presenter NOT called, breadcrumb records "redirect".
    inScope(() => handle(makeError({ code: "AUTH_REQUIRED", details: null })));
    expect(env.presenter.present).not.toHaveBeenCalled();
    expect(env.reporter.breadcrumb.mock.calls[1]![1]).toBe("redirect");
  });

  it("threads per-call ctx.correlationId into the breadcrumb key", () => {
    inScope(() =>
      handle(makeError({ code: "NETWORK_ERROR", details: null }), {
        ctx: { correlationId: "override-corr" },
      }),
    );

    const [, , ctx] = env.reporter.breadcrumb.mock.calls[0]!;
    expect(ctx.correlationId).toBe("override-corr");
  });
});
