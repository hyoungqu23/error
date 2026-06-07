// error/normalize.ts  — Step 1 of the single processing path.
import {
  AppError,
  appError,
  isAppError,
  isClientErrorPayload,
  isSerializedError,
  type SerializedError,
} from "./decision/app-error";
import { makeError, unknownCodeForRuntime } from "./make-error";
import type { ErrorCode } from "./decision/codes";

/**
 * Promote a caught value to a KNOWN AppError — or return null if no specific shape applies.
 * NO UNKNOWN_* fallback here: that policy belongs to the caller (`normalizeToAppError` falls back
 * by runtime; the decision-system promoter falls back to its own catalog's fallbackErrorCode so the
 * P2 server/client UNKNOWN split is preserved). This is the reusable promoter that gets injected
 * into the pipeline via `DecisionSystemOptions.normalizeUnknown`.
 *
 * Ordered branches — order is load-bearing:
 *   1. AppError instance     → return (same-runtime throw); stamp ctx correlationId if absent.
 *   2. real Error            → map known framework/network shapes (AbortError/TypeError-fetch/
 *                              TimeoutError) via mapKnownError; null for unrecognized Errors.
 *   3. plain SerializedError → AppError.fromSerialized (crossed the wire; instanceof Error is
 *                              false on the client — THE killer case).
 *   3b. ClientErrorPayload   → AppError.fromClientSerialized (client-trusted wire).
 *   else                     → null (caller decides the UNKNOWN_* fallback).
 * A wire-borne correlationId always wins over the per-request one.
 *
 * 신뢰 경계(Claude 적대적 리뷰 finding #5 정정): wire 분기(3/3b)는 `!(input instanceof Error)`로
 * 가드한다 — "실제 Error 인스턴스는 절대 wire로 오인되지 않는다"를 코드로 강제한다. 보장 범위는
 * 정확히 이만큼이다: Error는 mapKnownError가 매핑하거나(3개 형태) null이며, wire 덕타이핑(예: 메시지가
 * isSerializedError를 우연히 만족하는 Error)으로 재수화되지 않는다. 그 외 형태(plain object 등)에
 * 대한 추가 보호는 없다 — plain wire 객체는 의도대로 3/3b로 재수화된다(rehydration.test.ts의
 * verbatim 재수화 계약 유지). 과거 주석은 "Error도 wire로부터 보호된다"를 단순히 분기 재정렬로
 * 달성한 것처럼 과대 서술했으나, 실제 보장은 이 명시적 가드가 제공한다.
 */
export const tryNormalizeKnownError = (
  input: unknown,
  correlationId?: string,
): AppError | null => {
  if (isAppError(input)) return stampCorrelation(input, correlationId); // 1

  if (input instanceof Error) {
    // 2 — real Error: ONLY the dedicated framework/network mapping. Never the wire duck-types
    // (those are gated out below), so a real Error can never be misread as server-trusted wire.
    return mapKnownError(input, correlationId);
  }

  // wire 분기는 non-Error 입력에만 적용된다(위 분기가 모든 Error를 이미 소비·반환했으므로 이
  // 가드는 사실상 불변식의 명시화다 — 미래의 재정렬/리팩터가 Error를 wire로 흘리지 못하게 못 박는다).
  if (!(input instanceof Error) && isSerializedError(input)) {
    // 3
    const withId: SerializedError =
      input.correlationId === undefined && correlationId !== undefined
        ? { ...input, correlationId }
        : input;
    return AppError.fromSerialized(withId);
  }

  if (!(input instanceof Error) && isClientErrorPayload(input)) {
    // 3b
    const withId =
      input.correlationId === undefined && correlationId !== undefined
        ? { ...input, correlationId }
        : input;
    return AppError.fromClientSerialized(withId);
  }

  return null;
};

/**
 * Coerce ANY caught value into a first-class AppError. Delegates the known-shape recognition to
 * `tryNormalizeKnownError`; everything it leaves unrecognized falls back to UNKNOWN_* by runtime.
 * This keeps the legacy behavior (and all existing normalize/rehydration tests) byte-for-byte
 * while exposing the reusable promoter for pipeline injection.
 */
export function normalizeToAppError(
  input: unknown,
  fallbackMessage?: string,
  correlationId?: string,
): AppError {
  const known = tryNormalizeKnownError(input, correlationId);
  if (known) return known;

  return makeError({
    code: unknownCodeForRuntime() as ErrorCode,
    details: null,
    message: fallbackMessage ?? messageOf(input),
    cause: input,
    correlationId,
  });
}

// 알려진 fetch 실패 1차 문구만 매칭(앵커링) — Chrome/undici("failed to fetch"·"fetch failed"),
// Firefox("NetworkError when …"), React Native("Network request failed"), Safari("Load failed").
// `network`를 광범위하게 매칭하던 과거 정규식은 "Cannot read properties of undefined (reading
// 'network…')" 같은 코드 버그성 TypeError까지 NETWORK_ERROR로 오분류했다(Red Team CRITICAL).
const FETCH_FAILURE_MESSAGE =
  /^(failed to fetch|fetch failed|networkerror when|network request failed|load failed)/i;

/**
 * Recognize framework/network Error shapes worth a dedicated code — STRUCTURAL signals only.
 *
 * 분류 강등 방지(Red Team CRITICAL): 메시지 부분 매칭은 진짜 fault를 operational 코드로 강등시킨다.
 *   - timeout: name/code 같은 구조 신호로만 판별한다(`TimeoutError` / `code === "ETIMEDOUT"`).
 *     과거 `/timeout|ETIMEDOUT/i.test(message)`는 "session timeout exceeded"처럼 진짜 fault
 *     메시지를 operational TIMEOUT(capture:false·sampleRate 0.1·retryable)으로 강등시켰다.
 *   - fetch: name === "TypeError"는 유지하되 메시지를 알려진 fetch 실패 문구 세트로 좁힌다 —
 *     name만으로는 코드 버그성 TypeError("Cannot read properties of undefined")까지 잡힌다.
 */
function mapKnownError(error: Error, correlationId?: string): AppError | null {
  if (error.name === "AbortError")
    return makeError({ code: "REQUEST_ABORTED", details: null, cause: error, correlationId });
  if (error.name === "TypeError" && FETCH_FAILURE_MESSAGE.test(error.message)) {
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    return makeError({
      code: offline ? "OFFLINE" : "NETWORK_ERROR",
      details: null,
      cause: error,
      correlationId,
    });
  }
  // 구조 신호만: name 또는 Node의 `code === "ETIMEDOUT"`. 메시지 매칭은 하지 않는다.
  if (error.name === "TimeoutError" || (error as { code?: unknown }).code === "ETIMEDOUT")
    return makeError({ code: "TIMEOUT", details: null, cause: error, correlationId });
  return null;
}

const stampCorrelation = (e: AppError, correlationId?: string): AppError => {
  if (e.correlationId !== undefined || correlationId === undefined) return e;
  // correlationId is readonly; rebuild via the serialized contract so construction stays
  // the single validated path (no mutation of an existing instance).
  return AppError.fromSerialized({ ...e.toSerialized(), correlationId });
};

const messageOf = (input: unknown): string =>
  input instanceof Error
    ? input.message
    : typeof input === "string"
      ? input
      : "알 수 없는 오류가 발생했습니다.";
