// ============================================================================
// error/registry.ts  — SSOT leaf. NO bare ERROR_REGISTRY export; only DEFAULT.
// ============================================================================
import type { Severity } from "./severity";
import type { ErrorKind, PresentAction, LogLevel, HttpStatus } from "./policy";

export interface ErrorMeta {
  /** Intent axis (r5 SSOT). business = Track-1/Result selector; operational/fault otherwise. */
  readonly kind: ErrorKind;
  readonly severity: Severity; // first-class; drives default log level + Sentry level
  readonly present: PresentAction; // baseline user-visible-impact policy
  readonly log: LogLevel; // baseline log policy
  readonly httpStatus: HttpStatus; // 401/403/404/500 differentiation
  readonly retryable: boolean; // is a retry meaningful?
  readonly userMessageKey: string; // i18n key for the user-facing message
}

export const DEFAULT_ERROR_REGISTRY = {
  // ── business (mutations: Result로 반환 / queries: throw 후 error.code 분기) ──
  VALIDATION:           { kind: "business",    severity: "info",    present: "inline",   log: "none",    httpStatus: 422, retryable: false, userMessageKey: "error.validation" },
  INVALID_CREDENTIALS:  { kind: "business",    severity: "info",    present: "inline",   log: "info",    httpStatus: 401, retryable: false, userMessageKey: "error.invalidCredentials" },
  AUTH_REQUIRED:        { kind: "business",    severity: "info",    present: "redirect", log: "info",    httpStatus: 401, retryable: false, userMessageKey: "error.authRequired" },
  FORBIDDEN:            { kind: "business",    severity: "warning", present: "page",     log: "warning", httpStatus: 403, retryable: false, userMessageKey: "error.forbidden" },
  NOT_FOUND:            { kind: "business",    severity: "info",    present: "inline",   log: "none",    httpStatus: 404, retryable: false, userMessageKey: "error.notFound" },
  // ── operational (environmental/transient; non-fault) ──
  OFFLINE:              { kind: "operational", severity: "warning", present: "toast",    log: "warning", httpStatus: 503, retryable: true,  userMessageKey: "error.offline" },
  TIMEOUT:              { kind: "operational", severity: "warning", present: "toast",    log: "warning", httpStatus: 504, retryable: true,  userMessageKey: "error.timeout" },
  REQUEST_ABORTED:      { kind: "operational", severity: "info",    present: "silent",   log: "info",    httpStatus: 503, retryable: false, userMessageKey: "error.aborted" },
  NETWORK_ERROR:        { kind: "operational", severity: "warning", present: "toast",    log: "warning", httpStatus: 502, retryable: true,  userMessageKey: "error.network" },
  HTTP_CLIENT_ERROR:    { kind: "operational", severity: "warning", present: "toast",    log: "warning", httpStatus: 400, retryable: false, userMessageKey: "error.httpClient" },
  RATE_LIMITED:         { kind: "operational", severity: "warning", present: "toast",    log: "warning", httpStatus: 429, retryable: true,  userMessageKey: "error.rateLimited" },
  // ── fault (unexpected defect) ──
  HTTP_SERVER_ERROR:    { kind: "fault",       severity: "error",   present: "toast",    log: "error",   httpStatus: 500, retryable: true,  userMessageKey: "error.httpServer" },
  SCHEMA_MISMATCH:      { kind: "fault",       severity: "error",   present: "toast",    log: "error",   httpStatus: 502, retryable: false, userMessageKey: "error.schema" },
  UNKNOWN_SERVER_ERROR: { kind: "fault",       severity: "fatal",   present: "toast",    log: "error",   httpStatus: 500, retryable: false, userMessageKey: "error.unknown" },
  UNKNOWN_CLIENT_ERROR: { kind: "fault",       severity: "error",   present: "toast",    log: "error",   httpStatus: 500, retryable: false, userMessageKey: "error.unknown" },
} as const satisfies Record<string, ErrorMeta>;

/**
 * An injectable registry. A substituted catalog (host extension / test double)
 * MUST stay a superset of DEFAULT keys so `ErrorCode` resolution never misses;
 * the resolver still falls back defensively to UNKNOWN_CLIENT_ERROR.
 */
export type ErrorRegistry = Record<ErrorCode, ErrorMeta>;

/** Literal union of canonical codes — derived from DEFAULT registry keys (SSOT). */
export type ErrorCode = keyof typeof DEFAULT_ERROR_REGISTRY;

// NOTE: `isExpectedCode` lives in app-error.ts (it reads the active registry),
// keeping registry.ts a dependency-free SSOT leaf and avoiding an import cycle
// with active-registry.ts. safeServerAction imports it from "@/error/app-error".
//
// NOTE: there is intentionally NO bare `ERROR_REGISTRY` export. The single
// runtime authority is the *active* registry (active-registry.ts) — either
// DEFAULT_ERROR_REGISTRY or the injected deps.registry bound at the composition
// root. Nothing reads a module-level mutable catalog directly.
