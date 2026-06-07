// §P2/Fix2 — baseline DecisionSystem wiring: fallback split + raw-error promotion.
//
// Pins two contracts on the SHARED baseline systems (error-system.ts), which are the policy SSOT
// the server/client roots compose:
//   1. P2 fallback split (regression pin — previously had NO direct test): a non-AppError that the
//      promoter declines must land on each system's OWN fallbackErrorCode — errorSystem →
//      UNKNOWN_SERVER_ERROR, clientErrorSystem → UNKNOWN_CLIENT_ERROR. (The promoter carrying its
//      own UNKNOWN_* fallback would collapse this split — forbidden.)
//   2. normalizeUnknown promotion: a raw framework/network error caught OUTSIDE networkBoundary
//      (AbortError, fetch TypeError) is promoted to its dedicated operational code instead of being
//      flattened to the fallback fault. These map through the injected tryNormalizeKnownError.
//
// Runs under the `node` environment: navigator is undefined, so a fetch TypeError maps to
// NETWORK_ERROR (not OFFLINE — that branch needs navigator.onLine === false).
import { describe, it, expect } from "vitest";

// Relative import: error-system.ts is owned by THIS package (the source modules import it as
// "./error-system" too). The vitest @/error/* catch-all would mis-route it to the error-core
// workspace package, where it does not exist.
import { errorSystem, clientErrorSystem } from "../error-system";

// The baseline systems share a single "unknown" operation; build an occurrence directly (the
// boundaries do the same — they construct occurrence with operation:"unknown" rather than
// makeOccurrence). criticality/uiScope are explicit so resolve has everything it needs.
const occurrence = {
  operation: "unknown",
  interaction: "query",
  uiScope: "page",
  criticality: "normal",
} as const;

describe("error-system baseline — P2 fallback split (regression pin)", () => {
  it("errorSystem.finalizeUnknown(new Error) → UNKNOWN_SERVER_ERROR", () => {
    // A plain Error is declined by the promoter (null) → falls back to the server system's own code.
    const finalized = errorSystem.finalizeUnknown(new Error("boom"), occurrence, { runtime: "server" });
    expect(finalized.error.code).toBe("UNKNOWN_SERVER_ERROR");
    // The raw message never reaches the wire payload.
    expect(JSON.stringify(finalized.payload)).not.toContain("boom");
  });

  it("clientErrorSystem.finalizeUnknown(new Error) → UNKNOWN_CLIENT_ERROR", () => {
    const finalized = clientErrorSystem.finalizeUnknown(new Error("boom"), occurrence, { runtime: "client" });
    expect(finalized.error.code).toBe("UNKNOWN_CLIENT_ERROR");
  });

  it("a bare string is declined by the promoter and falls back per system", () => {
    expect(errorSystem.finalizeUnknown("nope", occurrence, { runtime: "server" }).error.code).toBe(
      "UNKNOWN_SERVER_ERROR",
    );
    expect(clientErrorSystem.finalizeUnknown("nope", occurrence, { runtime: "client" }).error.code).toBe(
      "UNKNOWN_CLIENT_ERROR",
    );
  });
});

describe("error-system baseline — normalizeUnknown promotion (raw catch outside networkBoundary)", () => {
  it("fetch TypeError → NETWORK_ERROR (promoted, not flattened to fallback fault)", () => {
    // The shape browsers throw on a failed fetch: TypeError with a 'fetch'/'network' message.
    const fetchFail = new TypeError("Failed to fetch");
    const finalized = errorSystem.finalizeUnknown(fetchFail, occurrence, { runtime: "server" });
    expect(finalized.error.code).toBe("NETWORK_ERROR");
  });

  it("AbortError → REQUEST_ABORTED (promoted)", () => {
    const abort = Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
    const finalized = clientErrorSystem.finalizeUnknown(abort, occurrence, { runtime: "client" });
    expect(finalized.error.code).toBe("REQUEST_ABORTED");
  });

  it("TimeoutError → TIMEOUT (promoted)", () => {
    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    const finalized = errorSystem.finalizeUnknown(timeout, occurrence, { runtime: "server" });
    expect(finalized.error.code).toBe("TIMEOUT");
  });
});

// ── 크로스 모델 P1 봉인: 주입 promoter는 Error 전용 — 파이프라인 raw catch의 plain object는
// wire 재수화되지 않는다. plain `{code,message}` 객체가 known-code AppError로 재수화되면
// errorResponder의 HTTP status/retryable/redirect를 외부 형태 객체가 선택할 수 있다(403 스푸핑 등).
describe("error-system baseline — promoter is Error-only (no plain-object wire rehydration, P1)", () => {
  it("thrown plain { code:'FORBIDDEN', message } → UNKNOWN_SERVER_ERROR on server (403 스푸핑 차단)", () => {
    const impostor = { code: "FORBIDDEN", message: "x" };
    const finalized = errorSystem.finalizeUnknown(impostor, occurrence, { runtime: "server" });
    expect(finalized.error.code).toBe("UNKNOWN_SERVER_ERROR");
    expect(finalized.payload.code).toBe("UNKNOWN_SERVER_ERROR");
  });

  it("thrown plain { code:'FORBIDDEN', message } → UNKNOWN_CLIENT_ERROR on client", () => {
    const impostor = { code: "FORBIDDEN", message: "x" };
    const finalized = clientErrorSystem.finalizeUnknown(impostor, occurrence, { runtime: "client" });
    expect(finalized.error.code).toBe("UNKNOWN_CLIENT_ERROR");
    expect(finalized.payload.code).toBe("UNKNOWN_CLIENT_ERROR");
  });

  it("impostor Error with a code prop but unmapped name → NOT rehydrated to NOT_FOUND (강등)", () => {
    // 실제 Error 인스턴스이지만 mapKnownError가 인식하는 name이 아니다 → mapKnownError null →
    // promoter null → fallback. code 프로퍼티(wire 덕타이핑)로 NOT_FOUND 재수화되지 않는다.
    const impostor = Object.assign(new Error("x"), { code: "NOT_FOUND" });
    const finalized = errorSystem.finalizeUnknown(impostor, occurrence, { runtime: "server" });
    expect(finalized.error.code).toBe("UNKNOWN_SERVER_ERROR");
  });

  it("Error with name:'AbortError' + code:'NOT_FOUND' → REQUEST_ABORTED (매핑이 wire보다 우선)", () => {
    // name 매핑이 살아 있고 wire 분기는 Error에 대해 닫혀 있으므로, code 프로퍼티가 아니라
    // AbortError 매핑이 이긴다.
    const impostor = Object.assign(new Error("x"), { name: "AbortError", code: "NOT_FOUND" });
    const finalized = clientErrorSystem.finalizeUnknown(impostor, occurrence, { runtime: "client" });
    expect(finalized.error.code).toBe("REQUEST_ABORTED");
  });
});
