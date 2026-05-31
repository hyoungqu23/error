// error/serialize-client.ts  — the LEAK-PREVENTION ENFORCEMENT POINT
// The only path by which an error reaches a CLIENT. Internal/server serialization
// keeps `message`; client serialization drops it and gates `details` by allowlist.
// Free functions (not methods) so app-error.ts need not import this file (no cycle).
import type { ErrorCode } from "./registry";
import type { ErrorDetailsMap } from "./schema";
import type { DomainError } from "./app-error";

/**
 * Client-bound DTO. NOTE: no free-text `message` field — copy is resolved on the
 * client from `userMessageKey` (i18n). This is the type that crosses to the browser
 * via Result.Failure (§7.1) and Route Handlers (§7.4).
 */
export interface ClientSerializedError {
  readonly code: ErrorCode;
  readonly userMessageKey: string;
  readonly correlationId?: string;
  readonly digest?: string;
  /** Present ONLY for codes whose details are allowlisted, and only the picked fields. */
  readonly details?: unknown;
}

/**
 * Per-code allowlist for client-bound `details`. Each entry is the EXACT set of keys
 * that may cross to the browser. A code absent (or mapped to `null`) sends NO details.
 *   VALIDATION.fieldErrors    → YES (the user must see which fields failed)
 *   RATE_LIMITED.retryAfterMs → YES (the public Retry-After value; non-sensitive countdown copy)
 *   SCHEMA_MISMATCH.endpoint  → NO  (leaks internal API topology)
 *   FORBIDDEN.requiredRole    → NO  (leaks authorization model)
 *   NOT_FOUND.resource        → NO  (leaks internal resource names)
 *   HTTP_*.status             → server-diagnostic, not user copy
 * Keyed over ALL ErrorCodes so adding a code without a decision is a compile error.
 *
 * G1: the array branch is typed `ReadonlyArray<Extract<keyof <details>, string>>` so a
 * key absent from the per-code Zod schema is now a COMPILE error (not silent dead weight).
 * `NonNullable<…>` strips the `.nullable()` so object keys survive `keyof`.
 */
type DetailsPicker = (d: unknown) => unknown;
type AllowedKeys<C extends ErrorCode> = Extract<keyof NonNullable<ErrorDetailsMap[C]>, string>;

export const DETAILS_ALLOWLIST: {
  [C in ErrorCode]: ReadonlyArray<AllowedKeys<C>> | DetailsPicker | null;
} = {
  VALIDATION: ["fieldErrors"],
  INVALID_CREDENTIALS: null,
  AUTH_REQUIRED: null,
  FORBIDDEN: null, // requiredRole intentionally withheld
  NOT_FOUND: null, // resource intentionally withheld
  OFFLINE: null,
  TIMEOUT: null,
  REQUEST_ABORTED: null,
  NETWORK_ERROR: null,
  HTTP_CLIENT_ERROR: null, // status withheld
  RATE_LIMITED: ["retryAfterMs"], // public Retry-After value — drives the countdown copy
  HTTP_SERVER_ERROR: null, // status withheld
  SCHEMA_MISMATCH: null, // endpoint withheld
  UNKNOWN_SERVER_ERROR: null,
  UNKNOWN_CLIENT_ERROR: null,
};

/** Shallow-pick only allowlisted keys from a plain object; drop everything else. */
const pickAllowed = (
  details: unknown,
  keys: ReadonlyArray<string>,
): Record<string, unknown> | undefined => {
  if (details === null || typeof details !== "object") return undefined;
  const src = details as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  let hit = false;
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(src, k)) {
      out[k] = src[k];
      hit = true;
    }
  }
  return hit ? out : undefined;
};

/** Gate an error's details through the allowlist. Returns `undefined` to omit the field entirely. */
export const gateClientDetails = (code: ErrorCode, details: unknown): unknown => {
  const rule = DETAILS_ALLOWLIST[code];
  if (rule === null) return undefined;
  if (typeof rule === "function") {
    const picked = rule(details);
    return picked == null ? undefined : picked;
  }
  return pickAllowed(details, rule);
};

/**
 * THE enforcement point. Build the client-bound DTO from a DomainError, dropping
 * free-text message and gating details. `digest` (RSC) is threaded when present.
 */
export const toClientSerialized = (error: DomainError, digest?: string): ClientSerializedError => {
  const details = gateClientDetails(error.code, error.details);
  const dto: ClientSerializedError = {
    code: error.code,
    userMessageKey: error.userMessageKey,
    correlationId: error.correlationId,
    ...(digest !== undefined ? { digest } : {}),
    ...(details !== undefined ? { details } : {}),
  };
  return dto;
};
