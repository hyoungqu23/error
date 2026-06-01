// error/normalize.ts  — Step 1 of the single processing path.
import {
  DomainError,
  isClientSerializedError,
  isDomainError,
  isSerializedError,
  type SerializedError,
} from "./app-error";
import { makeError, unknownCodeForRuntime } from "./make-error";
import type { ErrorCode } from "./registry";

/**
 * Coerce ANY caught value into a first-class DomainError. Ordered branches — order is
 * load-bearing:
 *   1. DomainError instance  → return (same-runtime throw); stamp ctx correlationId if absent.
 *   2. plain SerializedError → DomainError.fromSerialized (crossed the wire; instanceof is
 *                              false on the client — THE killer case).
 *   3. real Error            → map known framework/network shapes, else UNKNOWN_* by runtime.
 *   4. anything else         → UNKNOWN_* by runtime.
 * A wire-borne correlationId always wins over the per-request one.
 */
export function normalizeToDomainError(
  input: unknown,
  fallbackMessage?: string,
  correlationId?: string,
): DomainError {
  if (isDomainError(input)) return stampCorrelation(input, correlationId); // 1

  if (isSerializedError(input)) {
    // 2
    const withId: SerializedError =
      input.correlationId === undefined && correlationId !== undefined
        ? { ...input, correlationId }
        : input;
    return DomainError.fromSerialized(withId);
  }

  if (isClientSerializedError(input)) {
    const withId =
      input.correlationId === undefined && correlationId !== undefined
        ? { ...input, correlationId }
        : input;
    return DomainError.fromClientSerialized(withId);
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
function mapKnownError(error: Error, correlationId?: string): DomainError | null {
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

const stampCorrelation = (e: DomainError, correlationId?: string): DomainError => {
  if (e.correlationId !== undefined || correlationId === undefined) return e;
  // correlationId is readonly; rebuild via the serialized contract so construction stays
  // the single validated path (no mutation of an existing instance).
  return DomainError.fromSerialized({ ...e.toSerialized(), correlationId });
};

const messageOf = (input: unknown): string =>
  input instanceof Error
    ? input.message
    : typeof input === "string"
      ? input
      : "알 수 없는 오류가 발생했습니다.";

/**
 * @deprecated Use {@link normalizeToDomainError}. Unifies the old `normalize()` name;
 * kept only to ease migration, removed in the next major.
 */
export const normalize = normalizeToDomainError;
