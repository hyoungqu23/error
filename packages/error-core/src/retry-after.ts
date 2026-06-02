// error/retry-after.ts — pure parsing + the "how long until retry?" oracle (client + server safe)
import { isAppError } from "./decision/app-error";

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

/** 서버 제공 retry 힌트(ms): 인스턴스 retryAfterMs(D5 단일 소스) 우선, 없으면 details.retryAfterMs(레거시). */
export const retryAfterHintFromError = (err: unknown): number | undefined => {
  if (!isAppError(err)) return undefined;
  const valid = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
  if (valid(err.retryAfterMs)) return err.retryAfterMs;
  const details = err.details as { retryAfterMs?: unknown } | null | undefined;
  return valid(details?.retryAfterMs) ? (details!.retryAfterMs as number) : undefined;
};
