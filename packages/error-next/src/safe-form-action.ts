// error/safe-form-action.ts  — the form-mutation boundary, useActionState-compatible.
// Signature is `(prevState, formData) => Promise<Result<R>>` so it composes directly with
// React's useActionState and a progressively-enhanced <form action>. Shares identical
// control-flow + reporting plumbing with safeServerAction; differs only in input
// adaptation (raw FormData → plain object before Zod parse).
import "server-only";
import { z } from "zod";
import { isDomainError, isExpectedCode } from "error-core/app-error";
import { makeError } from "error-core/make-error";
import { rethrowControlFlow } from "./next-control-flow";
import { getRequestHandler } from "./request-handler.server";
import { actionSuccess, actionFailure, type Result } from "error-core/result";

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
    let parsed: z.SafeParseReturnType<unknown, z.infer<S>>;
    try {
      // Preserve duplicate field names as arrays; Zod owns coercion/refinement.
      parsed = schema.safeParse(formDataToObject(formData));
    } catch (error) {
      // safeParse never throws; a throw here is a programmer/runtime fault → unexpected path.
      rethrowControlFlow(error);
      const handleServerError = await getRequestHandler();
      handleServerError(error, { present: "silent" });
      throw error;
    }

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

    try {
      return actionSuccess(await action(parsed.data, prevState));
    } catch (error) {
      // 1. NEVER swallow framework control flow (redirect/notFound/forbidden/unauthorized).
      rethrowControlFlow(error);
      // 2. Expected business error → return as Failure (serialization-safe, crosses to client).
      if (isDomainError(error) && isExpectedCode(error.code)) return actionFailure(error);
      // 3. Unexpected → report on the per-request handler (server presenter no-op), then re-throw.
      // present:"silent" — server has no DOM; the client surfaces + breadcrumbs the impact.
      const handleServerError = await getRequestHandler();
      handleServerError(error, { present: "silent" });
      throw error;
    }
  };
