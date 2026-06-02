// error-core/decision/catalog.ts — DEFAULT_ERROR_REGISTRY(15코드) → ErrorSemantics 파생.
// sensitivity + per-disclosure messageKeys는 신규 authored(보안 disclosure 축).
import type { ErrorCatalog } from "./types";

export const CANONICAL_ERROR_SEMANTICS = {
  // ── business ──
  VALIDATION: {
    code: "VALIDATION", category: "business", sensitivity: "public",
    defaultHttpStatus: 422, defaultRetryable: false,
    defaultMessageKey: "error.validation", defaultAction: "fix-input",
    detailsExposure: "allowlist", detailsAllowlist: ["fieldErrors"],
  },
  // auth/permission 코드는 defaultMessageKey 자체가 safe-vague이므로 messageKeys["safe-vague"]도
  // 같은 키를 재사용한다(dependency-free FALLBACK_MESSAGES에 별도 .safe 키가 없음; host 앱이 override 가능).
  INVALID_CREDENTIALS: {
    code: "INVALID_CREDENTIALS", category: "business", sensitivity: "auth",
    defaultHttpStatus: 401, defaultRetryable: false,
    defaultMessageKey: "error.invalidCredentials", defaultAction: "fix-input",
    messageKeys: { "safe-vague": "error.invalidCredentials" },
    detailsExposure: "none",
  },
  AUTH_REQUIRED: {
    code: "AUTH_REQUIRED", category: "business", sensitivity: "auth",
    defaultHttpStatus: 401, defaultRetryable: false,
    defaultMessageKey: "error.authRequired", defaultAction: "login",
    redirectTarget: "/login",
    messageKeys: { "safe-vague": "error.authRequired" },
    detailsExposure: "none",
  },
  FORBIDDEN: {
    code: "FORBIDDEN", category: "business", sensitivity: "permission",
    defaultHttpStatus: 403, defaultRetryable: false,
    defaultMessageKey: "error.forbidden", defaultAction: "request-access",
    messageKeys: { "safe-vague": "error.forbidden" },
    detailsExposure: "none",
  },
  NOT_FOUND: {
    code: "NOT_FOUND", category: "business", sensitivity: "public",
    defaultHttpStatus: 404, defaultRetryable: false,
    defaultMessageKey: "error.notFound", defaultAction: "go-back",
    detailsExposure: "none",
  },
  // ── operational ──
  OFFLINE: {
    code: "OFFLINE", category: "operational", sensitivity: "public",
    defaultHttpStatus: 503, defaultRetryable: true,
    defaultMessageKey: "error.offline", defaultAction: "retry",
    detailsExposure: "none",
  },
  TIMEOUT: {
    code: "TIMEOUT", category: "operational", sensitivity: "internal",
    defaultHttpStatus: 504, defaultRetryable: true,
    defaultMessageKey: "error.timeout", defaultAction: "retry",
    messageKeys: { generic: "error.timeout" },
    detailsExposure: "none",
  },
  REQUEST_ABORTED: {
    code: "REQUEST_ABORTED", category: "operational", sensitivity: "public",
    defaultHttpStatus: 503, defaultRetryable: false,
    defaultMessageKey: "error.aborted", defaultAction: "none",
    detailsExposure: "none",
  },
  NETWORK_ERROR: {
    code: "NETWORK_ERROR", category: "operational", sensitivity: "public",
    defaultHttpStatus: 502, defaultRetryable: true,
    defaultMessageKey: "error.network", defaultAction: "retry",
    detailsExposure: "none",
  },
  HTTP_CLIENT_ERROR: {
    code: "HTTP_CLIENT_ERROR", category: "operational", sensitivity: "public",
    defaultHttpStatus: 400, defaultRetryable: false,
    defaultMessageKey: "error.httpClient", defaultAction: "none",
    detailsExposure: "none",
  },
  RATE_LIMITED: {
    code: "RATE_LIMITED", category: "operational", sensitivity: "public",
    defaultHttpStatus: 429, defaultRetryable: true,
    defaultMessageKey: "error.rateLimited", defaultAction: "wait",
    detailsExposure: "allowlist", detailsAllowlist: ["retryAfterMs"],
  },
  // ── fault (criticality에 따라 generic 또는 support-only 도달) ──
  HTTP_SERVER_ERROR: {
    code: "HTTP_SERVER_ERROR", category: "fault", sensitivity: "internal",
    defaultHttpStatus: 500, defaultRetryable: true,
    defaultMessageKey: "error.httpServer", defaultAction: "retry",
    messageKeys: { generic: "error.httpServer", "support-only": "error.support" },
    detailsExposure: "none",
  },
  SCHEMA_MISMATCH: {
    code: "SCHEMA_MISMATCH", category: "fault", sensitivity: "internal",
    defaultHttpStatus: 502, defaultRetryable: false,
    defaultMessageKey: "error.schema", defaultAction: "contact-support",
    messageKeys: { generic: "error.schema", "support-only": "error.support" },
    detailsExposure: "none",
  },
  UNKNOWN_SERVER_ERROR: {
    code: "UNKNOWN_SERVER_ERROR", category: "fault", sensitivity: "internal",
    defaultHttpStatus: 500, defaultRetryable: false,
    defaultMessageKey: "error.unknown", defaultAction: "contact-support",
    messageKeys: { generic: "error.unknown", "support-only": "error.support" },
    detailsExposure: "none",
  },
  UNKNOWN_CLIENT_ERROR: {
    code: "UNKNOWN_CLIENT_ERROR", category: "fault", sensitivity: "internal",
    defaultHttpStatus: 500, defaultRetryable: false,
    defaultMessageKey: "error.unknown", defaultAction: "retry",
    messageKeys: { generic: "error.unknown", "support-only": "error.support" },
    detailsExposure: "none",
  },
} as const satisfies ErrorCatalog;
