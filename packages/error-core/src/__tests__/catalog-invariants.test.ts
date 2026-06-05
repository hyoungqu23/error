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

  // P3e 후속(리뷰): 구 registry 1:1 교차검증이 사라진 자리를, 신 카탈로그 SSOT 자체에 대한
  // 코드별 정확값 테이블로 복원한다(catalog.ts 값에서 직접 전사). 범위/타입 체크(위)만으로는
  // NOT_FOUND 404→409, OFFLINE true→false 같은 정확값 변이가 통과해버리므로 그 회귀를 RED로 만든다.
  const EXPECTED_STATUS_RETRYABLE: Record<ErrorCode, { status: number; retryable: boolean }> = {
    VALIDATION: { status: 422, retryable: false },
    INVALID_CREDENTIALS: { status: 401, retryable: false },
    AUTH_REQUIRED: { status: 401, retryable: false },
    FORBIDDEN: { status: 403, retryable: false },
    NOT_FOUND: { status: 404, retryable: false },
    OFFLINE: { status: 503, retryable: true },
    TIMEOUT: { status: 504, retryable: true },
    REQUEST_ABORTED: { status: 503, retryable: false },
    NETWORK_ERROR: { status: 502, retryable: true },
    HTTP_CLIENT_ERROR: { status: 400, retryable: false },
    RATE_LIMITED: { status: 429, retryable: true },
    HTTP_SERVER_ERROR: { status: 500, retryable: true },
    SCHEMA_MISMATCH: { status: 502, retryable: false },
    UNKNOWN_SERVER_ERROR: { status: 500, retryable: false },
    UNKNOWN_CLIENT_ERROR: { status: 500, retryable: false },
  };

  it.each(CODES)("code %s pins exact defaultHttpStatus / defaultRetryable", (code) => {
    expect(CANONICAL_ERROR_SEMANTICS[code].defaultHttpStatus).toBe(EXPECTED_STATUS_RETRYABLE[code].status);
    expect(CANONICAL_ERROR_SEMANTICS[code].defaultRetryable).toBe(EXPECTED_STATUS_RETRYABLE[code].retryable);
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
    // validateDetails는 retryAfterMs:number 또는 null(힌트 없는 429 — P2)을 허용한다(D1).
    expect(s.validateDetails?.({ retryAfterMs: 1000 })).toBe(true);
    expect(s.validateDetails?.(null)).toBe(true);
    expect(s.validateDetails?.({ retryAfterMs: "soon" })).toBe(false);
  });

  it("VALIDATION exposes fieldErrors and validates its shape (D1)", () => {
    const s = CANONICAL_ERROR_SEMANTICS.VALIDATION;
    expect(s.detailsExposure).toBe("allowlist");
    expect(s.detailsAllowlist).toEqual(["fieldErrors"]);
    expect(s.validateDetails?.({ fieldErrors: { email: ["required"] } })).toBe(true);
    expect(s.validateDetails?.("nope")).toBe(false);
    expect(s.validateDetails?.(null)).toBe(false);
    // P2: 값까지 string[] 강제 — 위조 중첩 객체가 allowlist를 타고 누출게이트를 못 넘는다.
    expect(s.validateDetails?.({ fieldErrors: { password: [{ rawPassword: "secret" }] } })).toBe(false);
    expect(s.validateDetails?.({ fieldErrors: { email: "required" } })).toBe(false);
  });

  it("validateCatalog passes for the canonical catalog (disclosure/messageKey invariant holds)", () => {
    expect(() => validateCatalog(CANONICAL_ERROR_SEMANTICS, "UNKNOWN_SERVER_ERROR")).not.toThrow();
  });
});
