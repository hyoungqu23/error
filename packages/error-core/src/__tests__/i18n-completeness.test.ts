// §10.3 — i18n fallback completeness CI guard.
//
// These tests are a build-breaker: if a new ErrorCode lands in the registry
// without co-located fallback copy, or if resolveErrorMessage ever leaks a raw
// key / throws, this file fails. Asserts the runtime invariants (the type-level
// `satisfies Record<ErrorCode, string>` only guards compile time).
import { describe, it, expect, vi } from "vitest";
import {
  resolveErrorMessage,
  FALLBACK_MESSAGES,
  type Translator,
} from "@/error/translator";
import { CANONICAL_ERROR_SEMANTICS } from "@/error/decision/catalog";
import type { ErrorCode } from "@/error/decision/codes";

const ALL_CODES = Object.keys(CANONICAL_ERROR_SEMANTICS) as ErrorCode[];

// The ultimate generic line resolveErrorMessage falls back to. Kept in sync with
// the source's GENERIC_FALLBACK (which is the value of the UNKNOWN_* entries).
const GENERIC_FALLBACK = FALLBACK_MESSAGES.UNKNOWN_SERVER_ERROR;

describe("§10.3 i18n fallback completeness (CI guard)", () => {
  it("registry is non-empty and has the documented 15 canonical codes", () => {
    // Guards against an accidentally-empty iteration making every assertion vacuous.
    expect(ALL_CODES.length).toBe(15);
    expect(ALL_CODES.length).toBeGreaterThan(0);
  });

  it("FALLBACK_MESSAGES has an entry for EVERY ErrorCode in the registry", () => {
    const missing = ALL_CODES.filter(
      (code) =>
        !(code in FALLBACK_MESSAGES) ||
        typeof FALLBACK_MESSAGES[code] !== "string" ||
        FALLBACK_MESSAGES[code].length === 0,
    );
    expect(missing).toEqual([]);
  });

  it("FALLBACK_MESSAGES has no EXTRA keys beyond the registry codes", () => {
    const registryKeys = new Set<string>(ALL_CODES);
    const extra = Object.keys(FALLBACK_MESSAGES).filter((k) => !registryKeys.has(k));
    expect(extra).toEqual([]);
  });

  it.each(ALL_CODES)(
    "resolveErrorMessage(%s) — raw ErrorCode resolves to non-empty copy that is NOT the raw key",
    (code) => {
      const msg = resolveErrorMessage(code);
      expect(typeof msg).toBe("string");
      expect(msg.length).toBeGreaterThan(0);
      expect(msg).not.toBe(code);
    },
  );

  it.each(ALL_CODES)(
    "resolveErrorMessage(userMessageKey of %s) resolves to non-empty copy that is NOT the raw key",
    (code) => {
      const key = CANONICAL_ERROR_SEMANTICS[code].defaultMessageKey;
      const msg = resolveErrorMessage(key);
      expect(typeof msg).toBe("string");
      expect(msg.length).toBeGreaterThan(0);
      expect(msg).not.toBe(key);
      // The registry userMessageKey must map to its co-located fallback copy.
      expect(msg).toBe(FALLBACK_MESSAGES[code]);
    },
  );

  it("an unknown key returns the safe generic fallback (no throw, never the raw key)", () => {
    const unknown = "some.totally.unregistered.key";
    let msg = "";
    expect(() => {
      msg = resolveErrorMessage(unknown);
    }).not.toThrow();
    expect(msg).toBe(GENERIC_FALLBACK);
    expect(msg).not.toBe(unknown);
    expect(msg.length).toBeGreaterThan(0);
  });

  it("an empty-string key returns the safe generic fallback (no throw)", () => {
    expect(() => resolveErrorMessage("")).not.toThrow();
    expect(resolveErrorMessage("")).toBe(GENERIC_FALLBACK);
  });

  it("a provided Translator is used when it returns a finished (non-key) string", () => {
    const t = vi.fn((key: string) => `translated:${key}`);
    const translator: Translator = { locale: "en", t };
    const out = resolveErrorMessage("error.validation", translator);
    expect(out).toBe("translated:error.validation");
    expect(t).toHaveBeenCalledWith("error.validation", undefined);
  });

  it("Translator vars are forwarded through to t()", () => {
    const t = vi.fn((key: string) => `t:${key}`);
    const translator: Translator = { locale: "en", t };
    resolveErrorMessage("error.validation", translator, { field: "email", n: 3 });
    expect(t).toHaveBeenCalledWith("error.validation", { field: "email", n: 3 });
  });

  it("falls back to co-located copy when the Translator echoes the raw key back (i18next miss convention)", () => {
    // A missing key in i18next/next-intl returns the key itself — must be rejected.
    const translator: Translator = { locale: "en", t: (key) => key };
    const out = resolveErrorMessage("error.validation", translator);
    expect(out).toBe(FALLBACK_MESSAGES.VALIDATION);
    expect(out).not.toBe("error.validation");
  });

  it("falls back to co-located copy when the Translator returns an empty string", () => {
    const translator: Translator = { locale: "en", t: () => "" };
    const out = resolveErrorMessage("error.validation", translator);
    expect(out).toBe(FALLBACK_MESSAGES.VALIDATION);
  });

  it("falls back (and does NOT throw) when the Translator throws", () => {
    const translator: Translator = {
      locale: "en",
      t: () => {
        throw new Error("broken i18n adapter");
      },
    };
    let out = "";
    expect(() => {
      out = resolveErrorMessage("error.validation", translator);
    }).not.toThrow();
    expect(out).toBe(FALLBACK_MESSAGES.VALIDATION);
  });

  it("a throwing Translator on an UNKNOWN key still degrades to the generic fallback", () => {
    const translator: Translator = {
      locale: "en",
      t: () => {
        throw new Error("boom");
      },
    };
    expect(resolveErrorMessage("nope.not.a.key", translator)).toBe(GENERIC_FALLBACK);
  });

  it("a null translator behaves like no translator (provider-free safety-net path)", () => {
    const out = resolveErrorMessage("error.forbidden", null);
    expect(out).toBe(FALLBACK_MESSAGES.FORBIDDEN);
  });

  // ── G2: RATE_LIMITED fallback is a {seconds} countdown via interpolation ──
  it("RATE_LIMITED fallback copy carries the {seconds} interpolation token", () => {
    // The template MUST contain the token so the countdown can be filled in.
    expect(FALLBACK_MESSAGES.RATE_LIMITED).toContain("{seconds}");
    // resolveErrorMessage interpolates the var into the co-located fallback.
    const out = resolveErrorMessage("error.rateLimited", null, { seconds: 5 });
    expect(out).toBe("5초 후 다시 시도해주세요.");
    expect(out).not.toContain("{seconds}");
  });

  it("RATE_LIMITED interpolation also works via the raw ErrorCode key", () => {
    const out = resolveErrorMessage("RATE_LIMITED", null, { seconds: 12 });
    expect(out).toBe("12초 후 다시 시도해주세요.");
  });

  it("RATE_LIMITED with NO vars leaves the token verbatim (never throws, never the raw key)", () => {
    // Defensive: a caller that forgets the var still gets the (non-throwing)
    // template, not the raw key — so the existing per-code .each guard holds.
    const out = resolveErrorMessage("error.rateLimited");
    expect(out).toBe(FALLBACK_MESSAGES.RATE_LIMITED);
    expect(out).not.toBe("error.rateLimited");
    expect(out).not.toBe("RATE_LIMITED");
  });

  it("RATE_LIMITED vars are forwarded to a host Translator unchanged", () => {
    const t = vi.fn((key: string, vars?: Record<string, unknown>) =>
      vars && "seconds" in vars ? `wait ${String(vars.seconds)}s` : `t:${key}`,
    );
    const translator: Translator = { locale: "en", t };
    const out = resolveErrorMessage("error.rateLimited", translator, { seconds: 7 });
    expect(out).toBe("wait 7s");
    expect(t).toHaveBeenCalledWith("error.rateLimited", { seconds: 7 });
  });
});
