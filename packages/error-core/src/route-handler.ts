// error/route-handler.ts
// Maps any AppError to the right HTTP status via `httpStatus`, attaching the correlation
// ID. The body is `toClientSerialized` (§5.2) — messageless, details-gated — so a Route
// Handler error response never leaks internal `message`/`details` to the caller.
import { isDomainError } from "./app-error";
import { makeError } from "./make-error";
import { toClientSerialized } from "./serialize-client";

export const toErrorResponse = (e: unknown, correlationId: string): Response => {
  const err = isDomainError(e)
    ? e
    : makeError({ code: "UNKNOWN_SERVER_ERROR", details: null, cause: e });
  return Response.json(toClientSerialized(err), {
    status: err.httpStatus,
    headers: { "x-request-id": correlationId },
  });
};
