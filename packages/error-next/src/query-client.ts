// error/query-client.ts  ('use client') — the shared QueryClient default.
// Makes `retryable` load-bearing on the read/query track and stops the TanStack default
// retry:3 from retrying 404s and other non-retryable codes.
"use client";
import { QueryClient, type QueryClientConfig } from "@tanstack/react-query";
import { isAppError, isKnownErrorCode, CANONICAL_ERROR_SEMANTICS } from "error-core";
import { computeRetryDelay, DEFAULT_BACKOFF, type BackoffConfig } from "error-core/backoff";

/** Max retry ATTEMPTS for retryable errors (count is 0-based per TanStack). */
export const MAX_QUERY_RETRIES = 3;

/**
 * Shared retry predicate. NON-AppErrors are NOT retried; an AppError is retried only while
 * its catalog `defaultRetryable` is true AND under the attempt cap.
 *   - NOT_FOUND (defaultRetryable:false) → false → NEVER retried (fixes default retry:3).
 *   - RATE_LIMITED / TIMEOUT / OFFLINE / NETWORK_ERROR / HTTP_SERVER_ERROR (defaultRetryable:true) → retried.
 */
export const shouldRetryQuery = (failureCount: number, error: unknown): boolean =>
  isAppError(error) &&
  isKnownErrorCode(error.code) &&
  CANONICAL_ERROR_SEMANTICS[error.code].defaultRetryable &&
  failureCount < MAX_QUERY_RETRIES;

export const buildQueryClientConfig = (
  backoff: BackoffConfig = DEFAULT_BACKOFF,
): QueryClientConfig => ({
  defaultOptions: {
    queries: {
      retry: shouldRetryQuery,
      retryDelay: (attempt, error) => computeRetryDelay(attempt, error, backoff), // 0-based attempt
    },
    mutations: {
      // Mutations are the Result track (§8.4): a thrown mutation error is unexpected. Honor
      // retryable for transient infra faults, but default to ~0 retries to avoid double-submitting.
      retry: (failureCount, error) =>
        // 카탈로그가 SSOT — OFFLINE이 향후 non-retryable로 바뀌면 이 분기도 함께 닫힌다.
        isAppError(error) &&
        error.code === "OFFLINE" &&
        CANONICAL_ERROR_SEMANTICS.OFFLINE.defaultRetryable &&
        failureCount < 1,
      retryDelay: (attempt, error) => computeRetryDelay(attempt, error, backoff),
    },
  },
});

export const createAppQueryClient = (backoff?: BackoffConfig): QueryClient =>
  new QueryClient(buildQueryClientConfig(backoff));

/** Module-map alias: the canonical `makeQueryClient` factory name. */
export const makeQueryClient = createAppQueryClient;
