// error/translator.ts
// i18n for `userMessageKey` (design §6.3), flattened to a single module per the
// canonical module map. The error core depends only on the tiny `Translator` seam;
// vendor i18n knowledge would live in opt-in adapters (not shipped today — the live
// project is Korean-only). Invariant: the raw key is NEVER rendered; resolveErrorMessage
// NEVER throws.
//
// NOTE (module-map adaptation): the design kept a per-locale nested
// `FALLBACK_MESSAGES` (`Record<Locale, Record<ErrorCode, string>>`). The module map
// specifies `FALLBACK_MESSAGES: Record<ErrorCode, string>` (single default-locale
// column), so the map is the Korean default column and the `Translator.locale` seam
// is retained for host adapters that resolve other locales.
import type { ErrorCode } from "./registry";
import { DEFAULT_ERROR_REGISTRY } from "./registry";

export type TranslateVars = Record<string, string | number>;

/** The library-agnostic seam. A host i18n lib is wrapped behind this. */
export interface Translator {
  /** Resolve a message key to a finished string. MUST NOT return the raw key. */
  t(key: string, vars?: TranslateVars): string;
  /** Locale this translator resolves into (informational; used by host adapters). */
  readonly locale: string;
}

/**
 * CO-LOCATED fallback map, typed `Record<ErrorCode, string>` so a missing (or extra)
 * ErrorCode is a COMPILE error. A missing userMessageKey can never reach runtime.
 * Default-locale (Korean) column — the only locale shipping today.
 */
export const FALLBACK_MESSAGES = {
  VALIDATION: "입력값을 확인해주세요.",
  INVALID_CREDENTIALS: "아이디 또는 비밀번호가 올바르지 않습니다.",
  AUTH_REQUIRED: "로그인이 필요합니다.",
  FORBIDDEN: "접근 권한이 없습니다.",
  NOT_FOUND: "요청하신 내용을 찾을 수 없습니다.",
  OFFLINE: "네트워크 연결이 끊겼습니다. 연결을 확인해주세요.",
  TIMEOUT: "요청 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.",
  REQUEST_ABORTED: "요청이 취소되었습니다.",
  NETWORK_ERROR: "네트워크 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
  HTTP_CLIENT_ERROR: "요청을 처리할 수 없습니다.",
  RATE_LIMITED: "{seconds}초 후 다시 시도해주세요.",
  HTTP_SERVER_ERROR: "서버에서 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
  SCHEMA_MISMATCH: "데이터 형식 오류가 발생했습니다.",
  UNKNOWN_SERVER_ERROR: "알 수 없는 오류가 발생했습니다.",
  UNKNOWN_CLIENT_ERROR: "알 수 없는 오류가 발생했습니다.",
} as const satisfies Record<ErrorCode, string>;

const GENERIC_FALLBACK = "알 수 없는 오류가 발생했습니다.";

/** Reverse index: userMessageKey string → ErrorCode. Built once from the registry. */
const KEY_TO_CODE: Readonly<Record<string, ErrorCode>> = Object.freeze(
  (Object.keys(DEFAULT_ERROR_REGISTRY) as ErrorCode[]).reduce<Record<string, ErrorCode>>(
    (acc, code) => {
      acc[DEFAULT_ERROR_REGISTRY[code].userMessageKey] = code;
      return acc;
    },
    {},
  ),
);

/** Tiny `{token}` interpolation for the dependency-free fallback path. */
const interpolate = (template: string, vars?: TranslateVars): string =>
  vars
    ? template.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m))
    : template;

/**
 * Look up a finished fallback message for a `userMessageKey` (or a raw ErrorCode).
 * Returns `undefined` only if the key is neither a known registry userMessageKey nor
 * a literal ErrorCode.
 */
const fallbackMessage = (key: string, vars?: TranslateVars): string | undefined => {
  const code = KEY_TO_CODE[key] ?? (key in FALLBACK_MESSAGES ? (key as ErrorCode) : undefined);
  if (code === undefined) return undefined;
  return interpolate(FALLBACK_MESSAGES[code], vars);
};

/**
 * The single resolution function every consumer funnels through.
 * Layered: 1) injected host translator  2) co-located fallback  3) ultimate generic line.
 * Guarantees: NEVER returns the raw key, NEVER throws. Provider-free (no translator
 * argument) for global-error.tsx / the universal safety net.
 */
export const resolveErrorMessage = (
  key: string,
  translator?: Translator | null,
  vars?: TranslateVars,
): string => {
  if (translator) {
    let hostResult: string | undefined;
    try {
      hostResult = translator.t(key, vars);
    } catch {
      hostResult = undefined; // a broken adapter must never break error UX
    }
    // i18next/next-intl convention: a missing key echoes the key back. Reject it.
    if (hostResult && hostResult !== key) return hostResult;
  }
  return fallbackMessage(key, vars) ?? GENERIC_FALLBACK;
};

/** A Translator that needs NO provider and NO i18n lib — the universal safety net. */
export const createFallbackTranslator = (locale = "ko"): Translator => ({
  locale,
  t: (key, vars) => fallbackMessage(key, vars) ?? GENERIC_FALLBACK,
});
