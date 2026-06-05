// error/with-retry.ts  (server-only) — server-side retry for retryable DAL calls.
// Honors CANONICAL_ERROR_SEMANTICS[code].defaultRetryable (the catalog SSOT) and a
// server-sent Retry-After hint carried on RATE_LIMITED errors. NON-retryable codes
// (NOT_FOUND, VALIDATION, FORBIDDEN, …) and non-AppError throws propagate IMMEDIATELY.
//
// The retry-delay oracle is error-core's `computeRetryDelay` (backoff.ts 단일 출처 —
// Retry-After hint가 backoff를 이기되 maxMs로 클램프, full-jitter fallback). 이 모듈은
// 카탈로그의 defaultRetryable 게이트와 루프만 소유한다.
import "server-only";
import {
  isAppError,
  isKnownErrorCode,
  CANONICAL_ERROR_SEMANTICS,
  computeRetryDelay,
  DEFAULT_BACKOFF,
  type BackoffConfig,
} from "error-core";

export interface WithRetryOptions {
  /** Max retry ATTEMPTS after the initial call. Default 3. */ readonly maxRetries?: number;
  readonly backoff?: BackoffConfig;
  readonly sleep?: (ms: number) => Promise<void>; // injectable for tests
  readonly rand?: () => number; // injectable jitter for tests
}

const realSleep = (ms: number): Promise<void> => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Retry a server-side async call while the thrown error is an AppError whose catalog
 * code is defaultRetryable.
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
