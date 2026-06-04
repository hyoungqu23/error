// error/with-retry.ts  (server-only) — server-side retry for retryable DAL calls.
// Honors DomainError.retryable (the registry SSOT flag) and a server-sent Retry-After
// hint carried on RATE_LIMITED errors. NON-retryable codes (NOT_FOUND, VALIDATION,
// FORBIDDEN, …) and non-DomainError throws propagate IMMEDIATELY — never retried.
//
// The retry-delay oracle + Retry-After hint extraction are inlined here so this module
// stays self-contained (no React/TanStack dependency): the framework-free delay policy.
import "server-only";
import { isAppError, isKnownErrorCode, CANONICAL_ERROR_SEMANTICS } from "error-core";

export interface BackoffConfig {
  /** Base delay for attempt 0, in ms. */ readonly baseMs: number;
  /** Hard ceiling so a Retry-After of "3600" can't pin a worker for an hour. */ readonly maxMs: number;
}

export const DEFAULT_BACKOFF: BackoffConfig = { baseMs: 1_000, maxMs: 30_000 };

/** Extract a server-provided retry hint (ms) from an error, if it carries one (RATE_LIMITED). */
const retryAfterHintFromError = (err: unknown): number | undefined => {
  if (!isAppError(err)) return undefined;
  const details = err.details as { retryAfterMs?: unknown } | null | undefined;
  const hint = details?.retryAfterMs;
  return typeof hint === "number" && Number.isFinite(hint) && hint >= 0 ? hint : undefined;
};

/** Full-jitter exponential backoff: random in [0, min(max, base*2^attempt)]. */
const exponentialBackoffWithJitter = (
  attempt: number,
  cfg: BackoffConfig,
  rand: () => number,
): number => {
  const exp = Math.min(cfg.maxMs, cfg.baseMs * 2 ** attempt);
  return Math.round(rand() * exp);
};

/**
 * THE retry-delay oracle. A server-sent Retry-After hint (carried on the error) wins over
 * computed backoff, but is still clamped to `maxMs`. Falls back to full-jitter backoff.
 * `attempt` is 0-based (0 = the delay before the first retry).
 */
const computeRetryDelay = (
  attempt: number,
  err: unknown,
  cfg: BackoffConfig,
  rand: () => number,
): number => {
  const hint = retryAfterHintFromError(err);
  if (hint !== undefined) return Math.min(hint, cfg.maxMs);
  return exponentialBackoffWithJitter(attempt, cfg, rand);
};

export interface WithRetryOptions {
  /** Max retry ATTEMPTS after the initial call. Default 3. */ readonly maxRetries?: number;
  readonly backoff?: BackoffConfig;
  readonly sleep?: (ms: number) => Promise<void>; // injectable for tests
  readonly rand?: () => number; // injectable jitter for tests
}

const realSleep = (ms: number): Promise<void> => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Retry a server-side async call while the thrown error is a retryable DomainError.
 * NON-retryable codes (NOT_FOUND, VALIDATION, FORBIDDEN, …) throw IMMEDIATELY — never retried.
 * A RATE_LIMITED error's Retry-After hint is honored by computeRetryDelay.
 *   Usage: const doc = await withRetry(() => fetchUpstreamDoc(id));
 */
export const withRetry = async <T>(
  fn: () => Promise<T>,
  opts: WithRetryOptions = {},
): Promise<T> => {
  const { maxRetries = 3, backoff = DEFAULT_BACKOFF, sleep = realSleep, rand = Math.random } = opts;
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      const canRetry =
        isAppError(error) &&
        isKnownErrorCode(error.code) &&
        CANONICAL_ERROR_SEMANTICS[error.code].defaultRetryable &&
        attempt < maxRetries;
      if (!canRetry) throw error;
      await sleep(computeRetryDelay(attempt, error, backoff, rand));
      attempt += 1;
    }
  }
};
