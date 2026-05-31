// error/safe-server-action.ts  — the RPC-style mutation boundary.
// Track 1 (expected business error) → return as a serialization-safe `Result` Failure.
// Track 2 (unexpected) → report on the per-request handler, then re-throw (caught by
// error.tsx). Framework control flow (redirect/notFound/forbidden/unauthorized) is NEVER
// swallowed — rethrowControlFlow re-surfaces all four interrupts untouched.
import "server-only";
import { z } from "zod";
import { isDomainError, isExpectedCode } from "error-core/app-error";
import { rethrowControlFlow } from "./next-control-flow";
import { actionSuccess, actionFailure, type Result } from "error-core/result";
import { makeError } from "error-core/make-error";
import { getRequestHandler } from "./request-handler.server";

export const safeServerAction =
  <S extends z.ZodTypeAny, R>(schema: S, action: (data: z.infer<S>) => Promise<R>) =>
  async (raw: z.infer<S>): Promise<Result<R>> => {
    const handleServerError = await getRequestHandler(); // ← await: per-request instance
    try {
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        return actionFailure(
          makeError({
            code: "VALIDATION",
            details: {
              fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
            },
          }),
        );
      }
      return actionSuccess(await action(parsed.data));
    } catch (error) {
      // 1. NEVER swallow framework control flow (redirect/notFound/forbidden/unauthorized).
      rethrowControlFlow(error);
      // 2. Track 1: expected business error → return as Failure (serialization-safe).
      if (isDomainError(error) && isExpectedCode(error.code)) return actionFailure(error);
      // 3. Track 2: unexpected → report (server presenter no-op) then re-throw.
      // present:"silent" — the server has no DOM and re-throws to error.tsx; the
      // user-visible impact (and its breadcrumb) is recorded on the client, not here.
      handleServerError(error, { present: "silent" });
      throw error;
    }
  };
