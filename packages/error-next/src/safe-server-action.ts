// error/safe-server-action.ts  — the RPC-style mutation boundary.
// Track 1 (expected business error) → finalize through the decision system (leak gate) and
// return as a serialization-safe `Result` Failure — NEVER reported (no telemetry).
// Track 2 (unexpected) → report on the per-request handler, then re-throw (caught by
// error.tsx). Framework control flow (redirect/notFound/forbidden/unauthorized) is NEVER
// swallowed — rethrowControlFlow re-surfaces all four interrupts untouched.
import "server-only";
import { z } from "zod";
import { isAppError, isKnownErrorCode, CANONICAL_ERROR_SEMANTICS } from "error-core";
import { actionSuccess, degrade, type Result } from "error-core/result";
import { makeError } from "error-core/make-error";
import { rethrowControlFlow } from "./next-control-flow";
import { getRequestHandler } from "./request-handler.server";
import { errorSystem } from "./error-system";

export const safeServerAction =
  <S extends z.ZodTypeAny, R>(schema: S, action: (data: z.infer<S>) => Promise<R>) =>
  async (raw: z.infer<S>): Promise<Result<R>> => {
    // Boundary occurrence: an RPC mutation surfaced at the form scope.
    const occurrence = errorSystem.makeOccurrence("unknown", {
      interaction: "mutation",
      uiScope: "form",
    });
    try {
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        // Validation failure → finalize to a wire payload through the leak gate. finalizeUnknown
        // resolves the decision + payload only — no telemetry runs (Track-1 is never reported).
        return degrade<R>(
          errorSystem.finalizeUnknown(
            makeError({
              code: "VALIDATION",
              details: {
                fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
              },
            }),
            occurrence,
            { runtime: "server" },
          ),
        );
      }
      return actionSuccess(await action(parsed.data));
    } catch (error) {
      // 1. NEVER swallow framework control flow (redirect/notFound/forbidden/unauthorized).
      rethrowControlFlow(error);
      // 2. Track 1: expected business error (catalog category "business" — replaces the old
      //    isExpectedCode) → Failure (serialization-safe), NOT reported.
      if (
        isAppError(error) &&
        isKnownErrorCode(error.code) &&
        CANONICAL_ERROR_SEMANTICS[error.code].category === "business"
      ) {
        return degrade<R>(errorSystem.finalizeUnknown(error, occurrence, { runtime: "server" }));
      }
      // 3. Track 2: unexpected → report on the per-request handler (telemetry runs), re-throw.
      //    The server has no DOM; the user-visible impact is recorded on the client (error.tsx).
      const handleServerError = await getRequestHandler();
      handleServerError(error);
      throw error;
    }
  };
