// error/make-error.ts — produces an AppError (decision model). zod ErrorDetailsSchema
// validation is kept transitionally (invalid → UNKNOWN_* fallback); schema.ts removal is P3e
// where validateDetails (D1) becomes the single details gate.
import { ErrorDetailsSchema } from "./schema";
import { appError, AppError } from "./decision/app-error";
import { getRuntime } from "./runtime";
import type { ErrorCode } from "./decision/codes";

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
  const parsed = ErrorDetailsSchema[opts.code].safeParse(opts.details);
  if (!parsed.success) {
    // Reaching this in prod is itself abnormal — a programmer mistake, by design.
    return appError(unknownCodeForRuntime(), null, {
      message: opts.message ?? "알 수 없는 오류가 발생했습니다.",
      cause: opts.cause ?? opts.details,
      correlationId: opts.correlationId,
      digest: opts.digest,
    });
  }
  return appError(opts.code, parsed.data, {
    message: opts.message,
    cause: opts.cause,
    correlationId: opts.correlationId,
    retryAfterMs: opts.retryAfterMs,
    userCanRetry: opts.userCanRetry,
    digest: opts.digest,
  });
};
