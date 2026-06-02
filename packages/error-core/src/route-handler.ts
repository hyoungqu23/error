// error/route-handler.ts
// Maps any AppError to the right HTTP status via `httpStatus`, attaching the correlation
// ID. The body is `toClientSerialized` (§5.2) — messageless, details-gated — so a Route
// Handler error response never leaks internal `message`/`details` to the caller.
import { DomainError, construct, isDomainError } from "./app-error";
import { toClientSerialized } from "./serialize-client";

export const toErrorResponse = (e: unknown, correlationId: string): Response => {
  // P3b-ii: route-handler + serialize-client remain on the OLD DomainError stack
  // (they read DomainError.httpStatus/userMessageKey getters) until P3c. Build the
  // fallback via the old `construct` so this path is unaffected by makeError → AppError.
  const base = isDomainError(e)
    ? e
    : construct("UNKNOWN_SERVER_ERROR", null, { cause: e, correlationId });
  const err =
    base.correlationId === undefined
      ? DomainError.fromSerialized({ ...base.toSerialized(), correlationId })
      : base;
  return Response.json(toClientSerialized(err), {
    status: err.httpStatus,
    headers: { "x-request-id": correlationId },
  });
};
