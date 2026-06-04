// error/safe-form-action.ts  — the form-mutation boundary, useActionState-compatible.
// Signature is `(prevState, formData) => Promise<Result<R>>` so it composes directly with
// React's useActionState and a progressively-enhanced <form action>. Shares identical
// control-flow + reporting plumbing with safeServerAction; differs only in input
// adaptation (raw FormData → plain object before Zod parse).
import "server-only";
import { z } from "zod";
import { isAppError, isKnownErrorCode, CANONICAL_ERROR_SEMANTICS } from "error-core";
import { actionSuccess, degrade, type Result } from "error-core/result";
import { makeError } from "error-core/make-error";
import { rethrowControlFlow } from "./next-control-flow";
import { getRequestHandler } from "./request-handler.server";
import { errorSystem } from "./error-system";

/** The state useActionState holds for a form: a prior Result, or null before first submit. */
export type FormState<R> = Result<R> | null;

type FormObject = Record<string, FormDataEntryValue | FormDataEntryValue[]>;

const formDataToObject = (formData: FormData): FormObject => {
  const out: FormObject = {};
  for (const [key, value] of formData.entries()) {
    const existing = out[key];
    if (existing === undefined) {
      out[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      out[key] = [existing, value];
    }
  }
  return out;
};

export const safeFormAction =
  <S extends z.ZodType, R>(
    schema: S,
    action: (input: z.infer<S>, prevState: FormState<R>) => Promise<R>,
  ) =>
  async (prevState: FormState<R>, formData: FormData): Promise<Result<R>> => {
    // Boundary occurrence: a form submission surfaced at the form scope.
    const occurrence = errorSystem.makeOccurrence("unknown", {
      interaction: "form-submit",
      uiScope: "form",
    });

    let parsed: z.SafeParseReturnType<unknown, z.infer<S>>;
    try {
      // Preserve duplicate field names as arrays; Zod owns coercion/refinement.
      parsed = schema.safeParse(formDataToObject(formData));
    } catch (error) {
      // safeParse never throws; a throw here is a programmer/runtime fault → unexpected path.
      rethrowControlFlow(error);
      const handleServerError = await getRequestHandler();
      handleServerError(error);
      throw error;
    }

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

    try {
      return actionSuccess(await action(parsed.data, prevState));
    } catch (error) {
      // 1. NEVER swallow framework control flow (redirect/notFound/forbidden/unauthorized).
      rethrowControlFlow(error);
      // 2. Track 1: expected business error (catalog category "business") → Failure, NOT reported.
      if (
        isAppError(error) &&
        isKnownErrorCode(error.code) &&
        CANONICAL_ERROR_SEMANTICS[error.code].category === "business"
      ) {
        return degrade<R>(errorSystem.finalizeUnknown(error, occurrence, { runtime: "server" }));
      }
      // 3. Track 2: unexpected → report on the per-request handler (telemetry runs), re-throw.
      const handleServerError = await getRequestHandler();
      handleServerError(error);
      throw error;
    }
  };
