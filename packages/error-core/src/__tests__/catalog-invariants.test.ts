// §10 — 통합 catalog 불변식 (P3e: 구 registry-invariants 대체).
// CANONICAL_ERROR_SEMANTICS(통합 정적 카탈로그)의 데이터 무결성을 테이블 구동으로 고정한다.
// 구 ErrorMeta(kind/present/log/severity/zod) 축은 신 ErrorSemantics(category/sensitivity/
// detailsExposure/validateDetails)로 대체됐다.
import { describe, it, expect } from "vitest";
import { CANONICAL_ERROR_SEMANTICS } from "@/error/decision/catalog";
import { KNOWN_ERROR_CODES, type ErrorCode } from "@/error/decision/codes";
import type { ErrorSemantics } from "@/error/decision/types";
import { validateCatalog } from "@/error/decision/validate";

const CODES = Object.keys(CANONICAL_ERROR_SEMANTICS) as ErrorCode[];

const CATEGORIES = ["business", "operational", "fault"] as const;
const SENSITIVITIES = ["public", "auth", "permission", "pii", "business-sensitive", "internal"] as const;

// 구 expected:true 집합 — 이제 category === "business".
const BUSINESS_CODES = [
  "VALIDATION",
  "INVALID_CREDENTIALS",
  "AUTH_REQUIRED",
  "FORBIDDEN",
  "NOT_FOUND",
] as const satisfies ReadonlyArray<ErrorCode>;

describe("§10 catalog invariants (P3e)", () => {
  it("catalog exposes the documented 15 codes and matches KNOWN_ERROR_CODES", () => {
    expect(CODES.length).toBe(15);
    expect([...KNOWN_ERROR_CODES].sort()).toEqual([...CODES].sort());
  });

  it("each entry's `code` field equals its catalog key (no drift)", () => {
    for (const code of CODES) {
      expect(CANONICAL_ERROR_SEMANTICS[code].code).toBe(code);
    }
  });

  describe.each(CODES)("code %s", (code) => {
    // catalog는 `as const satisfies`라 인덱싱 결과가 리터럴 union → ErrorSemantics로 평탄화해
    // optional 필드(detailsAllowlist/validateDetails)에 접근한다.
    const s: ErrorSemantics = CANONICAL_ERROR_SEMANTICS[code];

    it("category / sensitivity are members of their unions", () => {
      expect(CATEGORIES).toContain(s.category);
      expect(SENSITIVITIES).toContain(s.sensitivity);
    });

    it("defaultHttpStatus is a sensible HTTP status", () => {
      expect(s.defaultHttpStatus).toBeGreaterThanOrEqual(400);
      expect(s.defaultHttpStatus).toBeLessThan(600);
    });

    it("defaultMessageKey is a non-empty i18n key", () => {
      expect(typeof s.defaultMessageKey).toBe("string");
      expect(s.defaultMessageKey.length).toBeGreaterThan(0);
    });

    it("defaultRetryable is a boolean", () => {
      expect(typeof s.defaultRetryable).toBe("boolean");
    });

    // D6: allowlist 노출 코드는 비어있지 않은 문자열 키 배열을 가져야 한다.
    it("detailsExposure rule is well-formed (allowlist ⇒ non-empty string keys; none ⇒ no allowlist leak)", () => {
      if (s.detailsExposure === "allowlist") {
        expect(Array.isArray(s.detailsAllowlist)).toBe(true);
        expect(s.detailsAllowlist!.length).toBeGreaterThan(0);
        for (const key of s.detailsAllowlist!) {
          expect(typeof key).toBe("string");
          expect(key.length).toBeGreaterThan(0);
        }
      } else {
        expect(s.detailsExposure).toBe("none");
        // none 코드는 노출할 키가 없어야 한다(누출 표면 0).
        expect(s.detailsAllowlist ?? []).toHaveLength(0);
      }
    });
  });

  it("the business set is EXACTLY the five business-category codes", () => {
    const businessByCategory = CODES.filter((c) => CANONICAL_ERROR_SEMANTICS[c].category === "business");
    expect(businessByCategory.sort()).toEqual([...BUSINESS_CODES].sort());
  });

  it("UNKNOWN_SERVER_ERROR and UNKNOWN_CLIENT_ERROR are fault", () => {
    expect(CANONICAL_ERROR_SEMANTICS.UNKNOWN_SERVER_ERROR.category).toBe("fault");
    expect(CANONICAL_ERROR_SEMANTICS.UNKNOWN_CLIENT_ERROR.category).toBe("fault");
  });

  it("RATE_LIMITED is 429, retryable, and exposes retryAfterMs through the allowlist", () => {
    const s = CANONICAL_ERROR_SEMANTICS.RATE_LIMITED;
    expect(s.defaultHttpStatus).toBe(429);
    expect(s.defaultRetryable).toBe(true);
    expect(s.detailsExposure).toBe("allowlist");
    expect(s.detailsAllowlist).toContain("retryAfterMs");
    // validateDetails는 retryAfterMs:number를 요구한다(D1).
    expect(s.validateDetails?.({ retryAfterMs: 1000 })).toBe(true);
    expect(s.validateDetails?.({ retryAfterMs: "soon" })).toBe(false);
  });

  it("VALIDATION exposes fieldErrors and validates its shape (D1)", () => {
    const s = CANONICAL_ERROR_SEMANTICS.VALIDATION;
    expect(s.detailsExposure).toBe("allowlist");
    expect(s.detailsAllowlist).toEqual(["fieldErrors"]);
    expect(s.validateDetails?.({ fieldErrors: { email: ["required"] } })).toBe(true);
    expect(s.validateDetails?.("nope")).toBe(false);
    expect(s.validateDetails?.(null)).toBe(false);
  });

  it("validateCatalog passes for the canonical catalog (disclosure/messageKey invariant holds)", () => {
    expect(() => validateCatalog(CANONICAL_ERROR_SEMANTICS, "UNKNOWN_SERVER_ERROR")).not.toThrow();
  });
});
