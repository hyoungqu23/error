// §10 — Registry invariants (r5).
//
// Table-driven over Object.keys(DEFAULT_ERROR_REGISTRY). Asserts the SSOT
// registry stays internally consistent and consistent with the sibling
// ErrorDetailsSchema + the intent-axis lookup `isExpectedCode`.
//
// r5 rename: ErrorMeta no longer carries `expected: boolean` / `ux: UxAction`.
// It now carries `kind: ErrorKind` and `present: PresentAction`. The old
// boolean is derived: `isExpectedCode(code) === (meta.kind === "business")`.
// The old `none` PresentAction is SPLIT into `inline` (business-inline) and
// `silent` (truly-silent, e.g. REQUEST_ABORTED).
//
// G1 (added): every DETAILS_ALLOWLIST array key must be a real key of that
// code's Zod schema (now also compile-enforced via AllowedKeys<C>), and every
// z.null() schema code must carry a null/empty allowlist rule (no object keys
// to expose). Also asserts RATE_LIMITED.retryAfterMs is allowlisted.
//
// Environment note: vitest runs this under `environment: "node"`, so
// getRuntime() === "server" and (with no per-request AsyncLocalStorage store)
// getActiveErrorRegistry() falls back to DEFAULT_ERROR_REGISTRY. That is exactly
// the registry under test here, so isExpectedCode(code) reads the same catalog.
import { describe, it, expect } from "vitest";
import { z } from "zod";

import { DEFAULT_ERROR_REGISTRY, type ErrorCode } from "@/error/registry";
import { ErrorDetailsSchema } from "@/error/schema";
import { CANONICAL_ERROR_SEMANTICS } from "@/error/decision/catalog";
import { isExpectedCode } from "@/error/app-error";

// P3c: the per-code client-details allowlist SSOT is now `CANONICAL_ERROR_SEMANTICS[code]`
// (`detailsExposure` + `detailsAllowlist`), replacing the deleted `DETAILS_ALLOWLIST`. This shim
// projects the new semantics back to the old rule shape (array of keys | null) so the G1 invariants
// — allowlist ⊆ schema keys, z.null() codes expose nothing, RATE_LIMITED.retryAfterMs allowlisted —
// are preserved verbatim against the new source of truth.
const detailsAllowlistRule = (code: ErrorCode): readonly string[] | null => {
  const semantics = CANONICAL_ERROR_SEMANTICS[code];
  return semantics.detailsExposure === "allowlist" ? (semantics.detailsAllowlist ?? []) : null;
};
const DETAILS_ALLOWLIST = Object.fromEntries(
  (Object.keys(DEFAULT_ERROR_REGISTRY) as ErrorCode[]).map((code) => [code, detailsAllowlistRule(code)]),
) as Record<ErrorCode, readonly string[] | null>;

// Canonical vocabularies (mirror policy.ts / severity.ts). Kept as local
// literals so the test fails loudly if a registry row drifts to an
// out-of-union value (which `as const satisfies` would also catch at compile
// time, but we want a runtime guard here too).
const KINDS = ["business", "operational", "fault"] as const;
const SEVERITIES = ["fatal", "error", "warning", "info"] as const;
// r5: `none` is gone — split into `inline` (business-inline) + `silent`.
const PRESENT_ACTIONS = ["inline", "toast", "alert", "redirect", "page", "silent"] as const;
const LOG_LEVELS = ["fatal", "error", "warning", "info", "none"] as const;
const HTTP_STATUSES = [400, 401, 403, 404, 408, 409, 422, 429, 500, 502, 503, 504] as const;

const CODES = Object.keys(DEFAULT_ERROR_REGISTRY) as ErrorCode[];

// The exact business set (was the old `expected:true` set). isExpectedCode is
// derived from `kind === "business"`, so this set must match precisely.
const BUSINESS_CODES = [
  "VALIDATION",
  "INVALID_CREDENTIALS",
  "AUTH_REQUIRED",
  "FORBIDDEN",
  "NOT_FOUND",
] as const satisfies ReadonlyArray<ErrorCode>;

// ── G1 helper: surface the object-shape keys of a per-code Zod schema, ───────
// unwrapping `.nullable()` (and defensively `.optional()`). Returns `null` for
// a `z.null()` schema (no object keys can ever be exposed).
const schemaShapeKeys = (schema: z.ZodTypeAny): readonly string[] | null => {
  let s: z.ZodTypeAny = schema;
  // Peel nullable/optional wrappers to reach the inner type.
  // (ZodNullable/ZodOptional both expose `.unwrap()`.)
  while (s instanceof z.ZodNullable || s instanceof z.ZodOptional) {
    s = s.unwrap();
  }
  if (s instanceof z.ZodObject) {
    return Object.keys(s.shape as Record<string, unknown>);
  }
  // z.null(), z.record(), etc. — no fixed object keys to allowlist.
  return null;
};

describe("§10 registry invariants (r5)", () => {
  it("registry is non-empty and exposes the documented 15 codes", () => {
    expect(CODES.length).toBe(15);
  });

  it("every registry key has a matching ErrorDetailsSchema entry (and vice versa)", () => {
    const schemaKeys = Object.keys(ErrorDetailsSchema).sort();
    const registryKeys = [...CODES].sort();
    // 1:1 — no orphan schema entry, no code missing a schema.
    expect(schemaKeys).toEqual(registryKeys);
  });

  it("DETAILS_ALLOWLIST is keyed over exactly the registry codes", () => {
    const allowKeys = Object.keys(DETAILS_ALLOWLIST).sort();
    const registryKeys = [...CODES].sort();
    expect(allowKeys).toEqual(registryKeys);
  });

  describe.each(CODES)("code %s", (code) => {
    const meta = DEFAULT_ERROR_REGISTRY[code];

    it("has a Zod schema in ErrorDetailsSchema", () => {
      const schema = ErrorDetailsSchema[code];
      expect(schema).toBeDefined();
      // A Zod schema exposes safeParse — confirms it is a real schema, not junk.
      expect(typeof schema.safeParse).toBe("function");
    });

    it("kind / severity / present / log are members of their respective unions", () => {
      expect(KINDS).toContain(meta.kind);
      expect(SEVERITIES).toContain(meta.severity);
      expect(PRESENT_ACTIONS).toContain(meta.present);
      expect(LOG_LEVELS).toContain(meta.log);
    });

    it("httpStatus is a sensible HTTP status code", () => {
      expect(HTTP_STATUSES).toContain(meta.httpStatus);
      // Defensive numeric sanity in case the union literal list ever widens.
      expect(meta.httpStatus).toBeGreaterThanOrEqual(400);
      expect(meta.httpStatus).toBeLessThan(600);
    });

    it("userMessageKey is a non-empty i18n key", () => {
      expect(typeof meta.userMessageKey).toBe("string");
      expect(meta.userMessageKey.length).toBeGreaterThan(0);
    });

    it("retryable is a boolean", () => {
      expect(typeof meta.retryable).toBe("boolean");
    });

    it("isExpectedCode(code) is derived from kind === 'business'", () => {
      // r5 derivation: the old `meta.expected` is now `meta.kind === 'business'`.
      expect(isExpectedCode(code)).toBe(meta.kind === "business");
    });

    // ── G1: allowlist ⊆ schema keys (compile-enforced + runtime guard) ──
    it("every DETAILS_ALLOWLIST array key is a REAL key of this code's schema", () => {
      const rule = DETAILS_ALLOWLIST[code];
      if (!Array.isArray(rule)) return; // null / function rules are out of scope here
      const shapeKeys = schemaShapeKeys(ErrorDetailsSchema[code]);
      // An array rule only makes sense when the schema is an object with keys.
      expect(shapeKeys).not.toBeNull();
      for (const key of rule) {
        expect(shapeKeys).toContain(key);
      }
    });

    // ── G1: a z.null() schema code may not carry object keys to expose ──
    it("a z.null() schema code uses a null/empty allowlist rule (nothing to leak)", () => {
      const isNullSchema = ErrorDetailsSchema[code] instanceof z.ZodNull;
      if (!isNullSchema) return;
      const rule = DETAILS_ALLOWLIST[code];
      // No object keys exist, so the only safe rule is `null` (or an empty array).
      const ruleIsEmpty = rule === null || (Array.isArray(rule) && rule.length === 0);
      expect(ruleIsEmpty).toBe(true);
    });
  });

  // ── intent-axis derivation: the business set is exactly the old expected:true ──
  it("isExpectedCode is true for EXACTLY the five business codes", () => {
    const businessByKind = CODES.filter((c) => DEFAULT_ERROR_REGISTRY[c].kind === "business");
    expect(businessByKind.sort()).toEqual([...BUSINESS_CODES].sort());

    for (const code of CODES) {
      const isBusiness = (BUSINESS_CODES as readonly string[]).includes(code);
      expect(isExpectedCode(code)).toBe(isBusiness);
    }
  });

  it("isOperational derivation: operational + business are non-fault; fault is not operational", () => {
    for (const code of CODES) {
      const kind = DEFAULT_ERROR_REGISTRY[code].kind;
      // mirrors DomainError.get isOperational() = kind !== 'fault'
      const isOperational = kind !== "fault";
      expect(isOperational).toBe(kind === "business" || kind === "operational");
    }
  });

  it("REQUEST_ABORTED is the truly-silent operational code (present 'silent', not 'inline')", () => {
    const meta = DEFAULT_ERROR_REGISTRY.REQUEST_ABORTED;
    expect(meta.kind).toBe("operational");
    expect(meta.present).toBe("silent");
  });

  it("business-inline codes use present 'inline' (the non-silent half of the old 'none')", () => {
    expect(DEFAULT_ERROR_REGISTRY.VALIDATION.present).toBe("inline");
    expect(DEFAULT_ERROR_REGISTRY.NOT_FOUND.present).toBe("inline");
    expect(DEFAULT_ERROR_REGISTRY.INVALID_CREDENTIALS.present).toBe("inline");
  });

  it("the r5 present/kind matrix matches the R5 CONTRACT exactly", () => {
    const expected: Record<ErrorCode, { kind: string; present: string }> = {
      VALIDATION: { kind: "business", present: "inline" },
      INVALID_CREDENTIALS: { kind: "business", present: "inline" },
      AUTH_REQUIRED: { kind: "business", present: "redirect" },
      FORBIDDEN: { kind: "business", present: "page" },
      NOT_FOUND: { kind: "business", present: "inline" },
      OFFLINE: { kind: "operational", present: "toast" },
      TIMEOUT: { kind: "operational", present: "toast" },
      REQUEST_ABORTED: { kind: "operational", present: "silent" },
      NETWORK_ERROR: { kind: "operational", present: "toast" },
      HTTP_CLIENT_ERROR: { kind: "operational", present: "toast" },
      RATE_LIMITED: { kind: "operational", present: "toast" },
      HTTP_SERVER_ERROR: { kind: "fault", present: "toast" },
      SCHEMA_MISMATCH: { kind: "fault", present: "toast" },
      UNKNOWN_SERVER_ERROR: { kind: "fault", present: "toast" },
      UNKNOWN_CLIENT_ERROR: { kind: "fault", present: "toast" },
    };
    for (const code of CODES) {
      const meta = DEFAULT_ERROR_REGISTRY[code];
      expect({ kind: meta.kind, present: meta.present }).toEqual(expected[code]);
    }
  });

  it("RATE_LIMITED is 429, retryable, and exposes retryAfterMs through the allowlist", () => {
    const meta = DEFAULT_ERROR_REGISTRY.RATE_LIMITED;
    expect(meta.httpStatus).toBe(429);
    expect(meta.retryable).toBe(true);

    // G1: retryAfterMs is the public Retry-After value — allowlisted (non-sensitive).
    const rule = DETAILS_ALLOWLIST.RATE_LIMITED;
    expect(Array.isArray(rule)).toBe(true);
    expect(rule).toContain("retryAfterMs");
    // ...and it is a real key of the RATE_LIMITED schema.
    expect(schemaShapeKeys(ErrorDetailsSchema.RATE_LIMITED)).toContain("retryAfterMs");
  });

  it("UNKNOWN_SERVER_ERROR and UNKNOWN_CLIENT_ERROR exist and are kind 'fault' (not business)", () => {
    expect(DEFAULT_ERROR_REGISTRY.UNKNOWN_SERVER_ERROR).toBeDefined();
    expect(DEFAULT_ERROR_REGISTRY.UNKNOWN_CLIENT_ERROR).toBeDefined();
    expect(DEFAULT_ERROR_REGISTRY.UNKNOWN_SERVER_ERROR.kind).toBe("fault");
    expect(DEFAULT_ERROR_REGISTRY.UNKNOWN_CLIENT_ERROR.kind).toBe("fault");
    // ...and isExpectedCode reflects that intent axis (fault ⇒ not expected).
    expect(isExpectedCode("UNKNOWN_SERVER_ERROR")).toBe(false);
    expect(isExpectedCode("UNKNOWN_CLIENT_ERROR")).toBe(false);
  });
});
