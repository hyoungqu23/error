// error-core/make-error.ts — produces an AppError (decision model). 상세 검증은 카탈로그의
// per-code validateDetails(D1)로 게이트한다(zod 아님). validateDetails가 없는 코드는 느슨히 수용
// (D1: 검증 깊이 상실 수용 — 최종 보안 게이트는 finalize 시 system.finalize* + 누출게이트).
import { CANONICAL_ERROR_SEMANTICS } from "./decision/catalog";
import { appError, AppError } from "./decision/app-error";
import { getRuntime } from "./runtime";
import type { ErrorCode } from "./decision/codes";
import type { ErrorSemantics } from "./decision/types";

export const unknownCodeForRuntime = (): "UNKNOWN_SERVER_ERROR" | "UNKNOWN_CLIENT_ERROR" =>
  getRuntime() === "server" ? "UNKNOWN_SERVER_ERROR" : "UNKNOWN_CLIENT_ERROR";

export interface MakeErrorInput {
  code: ErrorCode;
  details?: unknown;
  message?: string;
  cause?: unknown;
  correlationId?: string;
  retryAfterMs?: number;
  userCanRetry?: boolean;
  digest?: string;
}

export const makeError = (opts: MakeErrorInput): AppError => {
  // catalog는 `as const satisfies`라 인덱싱 결과가 리터럴 union → ErrorSemantics로 평탄화해
  // optional validateDetails에 접근한다(opts.code는 ErrorCode이므로 항목은 항상 존재).
  const semantics = CANONICAL_ERROR_SEMANTICS[opts.code] as ErrorSemantics;
  const detailsValid = semantics.validateDetails ? semantics.validateDetails(opts.details) : true;
  if (!detailsValid) {
    // 여기 도달은 그 자체로 비정상 — 설계상 프로그래머 실수.
    return appError(unknownCodeForRuntime(), null, {
      message: opts.message ?? "알 수 없는 오류가 발생했습니다.",
      cause: opts.cause ?? opts.details,
      correlationId: opts.correlationId,
      digest: opts.digest,
    });
  }
  return appError(opts.code, opts.details ?? null, {
    message: opts.message,
    cause: opts.cause,
    correlationId: opts.correlationId,
    retryAfterMs: opts.retryAfterMs,
    userCanRetry: opts.userCanRetry,
    digest: opts.digest,
  });
};
