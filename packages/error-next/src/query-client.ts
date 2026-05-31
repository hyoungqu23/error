// error/query-client.ts  ('use client') — the shared QueryClient default.
// Makes `retryable` load-bearing on the read/query track and stops the TanStack default
// retry:3 from retrying 404s and other non-retryable codes.
"use client";
import { QueryClient, type QueryClientConfig } from "@tanstack/react-query";
import { isDomainError } from "error-core/app-error";
import { computeRetryDelay, DEFAULT_BACKOFF, type BackoffConfig } from "error-core/backoff";

/** Max retry ATTEMPTS for retryable errors (count is 0-based per TanStack). */
export const MAX_QUERY_RETRIES = 3;

/**
 * Shared retry predicate. NON-DomainErrors are NOT retried; a DomainError is retried only
 * while `err.retryable` is true AND under the attempt cap.
 *   - NOT_FOUND (retryable:false) → false → NEVER retried (fixes default retry:3).
 *   - RATE_LIMITED / TIMEOUT / OFFLINE / NETWORK_ERROR / HTTP_SERVER_ERROR (retryable:true) → retried.
 */
export const shouldRetryQuery = (failureCount: number, error: unknown): boolean =>
  isDomainError(error) && error.retryable && failureCount < MAX_QUERY_RETRIES;

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
        isDomainError(error) && error.retryable && error.code === "OFFLINE" && failureCount < 1,
      retryDelay: (attempt, error) => computeRetryDelay(attempt, error, backoff),
    },
  },
});

export const createAppQueryClient = (backoff?: BackoffConfig): QueryClient =>
  new QueryClient(buildQueryClientConfig(backoff));

/** Module-map alias: the canonical `makeQueryClient` factory name. */
export const makeQueryClient = createAppQueryClient;
