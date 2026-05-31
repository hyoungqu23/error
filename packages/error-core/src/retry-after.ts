// error/retry-after.ts — pure parsing + the "how long until retry?" oracle (client + server safe)
import { isDomainError } from "./app-error";

/**
 * Parse an HTTP `Retry-After` header (RFC 9110 §10.2.3) into milliseconds.
 *   - delta-seconds:  "120"
 *   - HTTP-date:      "Wed, 21 Oct 2025 07:28:00 GMT"
 * Returns a non-negative ms delay, or `undefined` if absent/unparseable. `now` injectable for tests.
 */
export const parseRetryAfter = (
  header: string | null | undefined,
  now: number = Date.now(),
): number | undefined => {
  if (header == null) return undefined;
  const trimmed = header.trim();
  if (trimmed === "") return undefined;
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000; // delta-seconds FIRST
  const dateMs = Date.parse(trimmed); // HTTP-date
  if (Number.isNaN(dateMs)) return undefined;
  return Math.max(0, dateMs - now);
};

/** Extract a server-provided retry hint (ms) from an error, if it carries one. */
export const retryAfterHintFromError = (err: unknown): number | undefined => {
  if (!isDomainError(err)) return undefined;
  const details = err.details as { retryAfterMs?: unknown } | null | undefined;
  const hint = details?.retryAfterMs;
  return typeof hint === "number" && Number.isFinite(hint) && hint >= 0 ? hint : undefined;
};
