// 에러 코드 어휘(SSOT) — 정본은 통합 카탈로그(CANONICAL_ERROR_SEMANTICS)다.
// (P3e: 구 DEFAULT_ERROR_REGISTRY 교차검증 제거 — 데이터 무결성은 catalog-invariants.test.ts가 담당.)
import { describe, it, expect } from "vitest";
import { CANONICAL_ERROR_SEMANTICS } from "../decision/catalog";
import { KNOWN_ERROR_CODES, isKnownErrorCode } from "../decision/codes";

describe("error code SSOT (P3e: catalog-derived)", () => {
  it("KNOWN_ERROR_CODES is exactly the catalog keys (15)", () => {
    expect([...KNOWN_ERROR_CODES].sort()).toEqual(Object.keys(CANONICAL_ERROR_SEMANTICS).sort());
    expect(KNOWN_ERROR_CODES.size).toBe(15);
  });
  it("isKnownErrorCode narrows known vs unknown", () => {
    expect(isKnownErrorCode("VALIDATION")).toBe(true);
    expect(isKnownErrorCode("RATE_LIMITED")).toBe(true);
    expect(isKnownErrorCode("NOPE_NOT_A_CODE")).toBe(false);
  });
});
