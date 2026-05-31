// error/backoff.ts — the shared delay policy (one place; reused by client + server)
import { retryAfterHintFromError } from "./retry-after";

export interface BackoffConfig {
  /** Base delay for attempt 0, in ms. */ readonly baseMs: number;
  /** Hard ceiling so a Retry-After of "3600" can't pin a tab for an hour. */ readonly maxMs: number;
}

export const DEFAULT_BACKOFF: BackoffConfig = { baseMs: 1_000, maxMs: 30_000 };

/** Full-jitter exponential backoff: random in [0, min(max, base*2^attempt)]. */
export const exponentialBackoffWithJitter = (
  attempt: number,
  cfg: BackoffConfig = DEFAULT_BACKOFF,
  rand: () => number = Math.random,
): number => {
  const exp = Math.min(cfg.maxMs, cfg.baseMs * 2 ** attempt);
  return Math.round(rand() * exp);
};

/**
 * THE retry-delay oracle. A server-sent Retry-After hint (carried on the error) wins over
 * computed backoff, but is still clamped to `maxMs`. Falls back to full-jitter backoff.
 * `attempt` is 0-based (0 = the delay before the first retry).
 */
export const computeRetryDelay = (
  attempt: number,
  err: unknown,
  cfg: BackoffConfig = DEFAULT_BACKOFF,
  rand: () => number = Math.random,
): number => {
  const hint = retryAfterHintFromError(err);
  if (hint !== undefined) return Math.min(hint, cfg.maxMs);
  return exponentialBackoffWithJitter(attempt, cfg, rand);
};
