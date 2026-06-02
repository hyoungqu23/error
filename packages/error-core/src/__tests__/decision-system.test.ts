import { describe, it, expect } from "vitest";
import type { ClientErrorPayload, UserErrorDecision, ReporterSink, NotifierSink } from "../decision/types";

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
