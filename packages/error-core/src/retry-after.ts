// error/retry-after.ts — pure parsing + the "how long until retry?" oracle (client + server safe)
import { isAppError } from "./decision/app-error";

/**
 * Parse 상한 — 악의적/버그난 업스트림의 `Retry-After: 999999999999`가 wire를 타고
 * 다년짜리 클라 카운트다운이 되지 않게 한 곳(parse)에서 클램프한다(1시간).
 * (서버 재시도 sleep은 computeRetryDelay가 별도로 backoff.maxMs로 클램프.)
 */
export const MAX_RETRY_AFTER_MS = 3_600_000;

/**
 * Parse an HTTP `Retry-After` header (RFC 9110 §10.2.3) into milliseconds.
 *   - delta-seconds:  "120"
 *   - HTTP-date:      "Wed, 21 Oct 2025 07:28:00 GMT"
 * Returns a non-negative ms delay clamped to MAX_RETRY_AFTER_MS, or `undefined` if
 * absent/unparseable. `now` injectable for tests.
 */
export const parseRetryAfter = (
  header: string | null | undefined,
  now: number = Date.now(),
): number | undefined => {
  if (header == null) return undefined;
  const trimmed = header.trim();
  if (trimmed === "") return undefined;
  if (/^\d+$/.test(trimmed)) return Math.min(Number(trimmed) * 1000, MAX_RETRY_AFTER_MS); // delta-seconds FIRST
  const dateMs = Date.parse(trimmed); // HTTP-date
  if (Number.isNaN(dateMs)) return undefined;
  return Math.min(Math.max(0, dateMs - now), MAX_RETRY_AFTER_MS);
};

/** 서버 제공 retry 힌트(ms): 인스턴스 retryAfterMs(D5 단일 소스) 우선, 없으면 details.retryAfterMs(레거시). */
export const retryAfterHintFromError = (err: unknown): number | undefined => {
  if (!isAppError(err)) return undefined;
  const valid = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
  if (valid(err.retryAfterMs)) return err.retryAfterMs;
  const details = err.details as { retryAfterMs?: unknown } | null | undefined;
  return valid(details?.retryAfterMs) ? (details!.retryAfterMs as number) : undefined;
};
