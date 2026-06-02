// error/result.ts — wire 계약. in-process DecisionResult는 decision/system이 소유;
// wire(서버→클라)로 건너는 건 누출게이트 통과분 ClientErrorPayload 뿐이다(D3).
import type { ClientErrorPayload } from "./decision/types";
import type { DecisionResult, DecisionFailure, Success } from "./decision/system";

export type { Success, DecisionResult, DecisionFailure };
export type Failure = { ok: false; error: ClientErrorPayload };
export type Result<T> = Success<T> | Failure;

export const actionSuccess = <T>(data: T): Success<T> => ({ ok: true, data });

/**
 * in-process DecisionResult → wire Result. DecisionFailure는 누출게이트 통과분(payload)만
 * 건너고 서버측 AppError/decision/occurrence는 버린다. Success는 그대로 통과.
 */
export const degrade = <T>(r: DecisionResult<T>): Result<T> =>
  r.ok ? r : { ok: false, error: r.payload };
