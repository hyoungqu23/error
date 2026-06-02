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
 * Coerce ANY caught value into a first-class AppError. Ordered branches — order is
 * load-bearing:
 *   1. AppError instance     → return (same-runtime throw); stamp ctx correlationId if absent.
 *   2. plain SerializedError → AppError.fromSerialized (crossed the wire; instanceof is
 *                              false on the client — THE killer case).
 *   2b. ClientErrorPayload   → AppError.fromClientSerialized (client-trusted wire).
 *   3. real Error            → map known framework/network shapes, else UNKNOWN_* by runtime.
 *   4. anything else         → UNKNOWN_* by runtime.
 * A wire-borne correlationId always wins over the per-request one.
 */
export function normalizeToAppError(
  input: unknown,
  fallbackMessage?: string,
  correlationId?: string,
): AppError {
  if (isAppError(input)) return stampCorrelation(input, correlationId); // 1

  if (isSerializedError(input)) {
    // 2
    const withId: SerializedError =
      input.correlationId === undefined && correlationId !== undefined
        ? { ...input, correlationId }
        : input;
    return AppError.fromSerialized(withId);
  }

  if (isClientErrorPayload(input)) {
    // 2b
    const withId =
      input.correlationId === undefined && correlationId !== undefined
        ? { ...input, correlationId }
        : input;
    return AppError.fromClientSerialized(withId);
  }

  if (input instanceof Error) {
    // 3
    const mapped = mapKnownError(input, correlationId);
    if (mapped) return mapped;
  }

  return makeError({
    // 3b / 4
    code: unknownCodeForRuntime() as ErrorCode,
    details: null,
    message: fallbackMessage ?? messageOf(input),
    cause: input,
    correlationId,
  });
}

/** Recognize framework/network Error shapes worth a dedicated code. */
function mapKnownError(error: Error, correlationId?: string): AppError | null {
  if (error.name === "AbortError")
    return makeError({ code: "REQUEST_ABORTED", details: null, cause: error, correlationId });
  if (error.name === "TypeError" && /fetch|network/i.test(error.message)) {
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    return makeError({
      code: offline ? "OFFLINE" : "NETWORK_ERROR",
      details: null,
      cause: error,
      correlationId,
    });
  }
  if (error.name === "TimeoutError" || /timeout|ETIMEDOUT/i.test(error.message))
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
