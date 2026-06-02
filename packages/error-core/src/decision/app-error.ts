// error-core/decision/app-error.ts — 통합 순수 데이터 에러 클래스(구 DomainError + EDS DomainError 합집합).
// 정책 getter 없음 — 정책은 decision/resolve.ts resolveErrorDecision이 카탈로그로 해소.
import type { OccurrenceContext, ClientErrorPayload } from "./types";
import { isKnownErrorCode } from "./codes";

// occurrence/userCanRetry는 서버-사이드 컨텍스트 전용이므로 wire에 포함하지 않음;
// retryAfterMs는 decision/messageVars 계산에 영향을 주므로 round-trip함.
export interface SerializedError {
  readonly code: string;
  readonly message: string;
  readonly details: unknown;
  readonly correlationId?: string;
  readonly digest?: string;
  readonly retryAfterMs?: number;
}

export interface AppErrorOptions {
  message?: string;
  cause?: unknown;
  occurrence?: Partial<OccurrenceContext>;
  correlationId?: string;
  retryAfterMs?: number;
  userCanRetry?: boolean;
  digest?: string;
}

export class AppError<C extends string = string> extends Error {
  readonly code: C;
  readonly details: unknown;
  override readonly cause?: unknown;
  readonly occurrence?: Partial<OccurrenceContext>;
  readonly correlationId?: string;
  readonly retryAfterMs?: number;
  readonly userCanRetry?: boolean;
  readonly digest?: string;

  constructor(code: C, details: unknown = null, options: AppErrorOptions = {}) {
    super(options.message ?? code);
    this.name = "AppError";
    this.code = code;
    this.details = details;
    this.cause = options.cause;
    this.occurrence = options.occurrence;
    this.correlationId = options.correlationId;
    this.retryAfterMs = options.retryAfterMs;
    this.userCanRetry = options.userCanRetry;
    this.digest = options.digest;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** 내부 직렬화(서버 로그용) — message + ungated details 유지. 클라 전송에는 toClientErrorPayload 사용. */
  toSerialized(): SerializedError {
    return { code: this.code, message: this.message, details: this.details, correlationId: this.correlationId, digest: this.digest, retryAfterMs: this.retryAfterMs };
  }

  /** 서버-신뢰 wire(SerializedError) → AppError 재수화. correlationId/digest/retryAfterMs 보존. */
  static fromSerialized(wire: SerializedError): AppError {
    return new AppError(wire.code, wire.details, { message: wire.message, correlationId: wire.correlationId, digest: wire.digest, retryAfterMs: wire.retryAfterMs });
  }

  /** 클라-신뢰 wire(ClientErrorPayload) → AppError 재수화. messageKey는 메시지로 쓰지 않음(키 그대로). */
  static fromClientSerialized(payload: ClientErrorPayload): AppError {
    return new AppError(payload.code, payload.details, {
      correlationId: payload.correlationId, digest: payload.digest, retryAfterMs: payload.retryAfterMs,
    });
  }
}

export const appError = <C extends string>(code: C, details: unknown = null, options: AppErrorOptions = {}): AppError<C> =>
  new AppError(code, details, options);

// instanceof + duck-type. "DomainError" name은 convergence 기간 동안 legacy/cross-package interop을 위해 허용함
// (아직 AppError로 마이그레이션되지 않은 구 error-core 에러).
export const isAppError = (value: unknown): value is AppError =>
  value instanceof AppError ||
  (typeof value === "object" && value !== null &&
    (((value as { name?: unknown }).name === "AppError") || ((value as { name?: unknown }).name === "DomainError")) &&
    typeof (value as { code?: unknown }).code === "string");

// (isKnownErrorCode는 codes.ts에서 — 멤버십 가드 D2가 P3b/P3c에서 사용)
export { isKnownErrorCode };
