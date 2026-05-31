"use server";

// app/demo/server-retry/actions.ts — 서버측 재시도(withRetry) 시연.
// withRetry는 DomainError.retryable(레지스트리 SSOT)과 RATE_LIMITED의 Retry-After 힌트를 존중한다.
// NON-retryable 코드(NOT_FOUND/VALIDATION/…)와 non-DomainError는 즉시 전파(재시도 X).
import { withRetry } from "error-next/server";
import { makeError, isDomainError } from "error-core";

// "처음 두 번은 실패, 세 번째에 성공"하는 flaky 업스트림을 모듈 카운터로 흉내낸다(데모용).
let attempts = 0;
async function flakyUpstream(): Promise<{ value: string; attempts: number }> {
  attempts += 1;
  if (attempts < 3) {
    // retryable:true 인 운영성 에러 → withRetry가 백오프 후 재시도한다.
    throw makeError({ code: "HTTP_SERVER_ERROR", details: { status: 503 } });
  }
  const settled = { value: "업스트림 응답 OK", attempts };
  attempts = 0; // 다음 시도를 위해 리셋
  return settled;
}

export type ServerRetryResult =
  | { ok: true; value: string; attempts: number }
  | { ok: false; code: string };

export async function runWithRetryDemo(): Promise<ServerRetryResult> {
  try {
    const result = await withRetry(() => flakyUpstream(), {
      maxRetries: 5,
      backoff: { baseMs: 50, maxMs: 200 },
    });
    return { ok: true, value: result.value, attempts: result.attempts };
  } catch (e) {
    return { ok: false, code: isDomainError(e) ? e.code : "UNKNOWN" };
  }
}
