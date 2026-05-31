// error/make-error.ts  — routes through construct() (compiles now);
// exports unknownCodeForRuntime() so normalize.ts shares the runtime fallback.
import { ErrorDetailsSchema } from "./schema";
import { DomainError, construct, type AppErrorOptions } from "./app-error";
import { getRuntime } from "./runtime";
import type { ErrorCode } from "./registry";

export const unknownCodeForRuntime = (): "UNKNOWN_SERVER_ERROR" | "UNKNOWN_CLIENT_ERROR" =>
  getRuntime() === "server" ? "UNKNOWN_SERVER_ERROR" : "UNKNOWN_CLIENT_ERROR";

export const makeError = <C extends ErrorCode>(opts: AppErrorOptions<C>): DomainError<C> => {
  const parsed = ErrorDetailsSchema[opts.code].safeParse(opts.details);
  if (!parsed.success) {
    // Reaching this in prod is itself abnormal — a programmer mistake, by design.
    return construct(unknownCodeForRuntime(), null, {
      message: opts.message ?? "알 수 없는 오류가 발생했습니다.",
      cause: opts.cause ?? opts.details,
      correlationId: opts.correlationId,
      digest: opts.digest,
    }) as DomainError<C>;
  }
  return construct(opts.code, parsed.data, {
    message: opts.message,
    cause: opts.cause,
    severity: opts.severity,
    retryable: opts.retryable,
    correlationId: opts.correlationId,
    digest: opts.digest,
  }) as DomainError<C>;
};
