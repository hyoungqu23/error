// error/route-handler.ts — AppError/unknown → messageless, details-gated HTTP Response.
import type { DecisionSystem } from "./decision/system";
import type { ErrorCatalog, OccurrenceContext, OperationCatalog } from "./decision/types";

/**
 * 주입된 decision-system으로 캐치값을 HTTP 응답으로 변환. body는 toClientErrorPayload 게이트
 * 통과분(ClientErrorPayload — message/details 누출 없음), status는 카탈로그 defaultHttpStatus.
 * Generic over the concrete catalog so a narrowly-typed `createDecisionSystem(...)` instance is
 * accepted without widening (the method params are invariant in the catalog type parameters).
 */
export const createErrorResponder =
  <Errors extends ErrorCatalog, Operations extends OperationCatalog>(
    system: DecisionSystem<Errors, Operations>,
  ) =>
  (
    error: unknown,
    occurrence: OccurrenceContext<Extract<keyof Operations, string>>,
    correlationId: string,
  ): Response => {
    const failure = system.finalizeUnknown(error, occurrence, { runtime: "server", correlationId });
    const status = system.errors[failure.error.code]?.defaultHttpStatus ?? 500;
    return Response.json(failure.payload, { status, headers: { "x-request-id": correlationId } });
  };
