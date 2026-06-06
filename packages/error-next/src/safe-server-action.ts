// error/safe-server-action.ts  — the RPC-style mutation boundary.
// Track 1 (expected business error) → finalize through the decision system (leak gate) and
// return as a serialization-safe `Result` Failure — NEVER reported (no telemetry).
// Track 2 (unexpected) → report on the per-request handler, then re-throw (caught by
// error.tsx). Framework control flow (redirect/notFound/forbidden/unauthorized) is NEVER
// swallowed — rethrowControlFlow re-surfaces all four interrupts untouched.
// Validation is validator-agnostic(safeFormAction과 동일 계약 — P0a 리뷰에서 두 경계의
// wire shape 비대칭을 막기 위해 통일): zod가 기본(zodFormValidator)이고 임의의 동기
// FormValidator가 주입 가능하다. 루트 오류는 toWireFieldErrors가 _form으로 합류.
import "server-only";
import type { z } from "zod";
import { isAppError, isKnownErrorCode, CANONICAL_ERROR_SEMANTICS } from "error-core";
import { actionSuccess, degrade, type Result } from "error-core/result";
import { makeError } from "error-core/make-error";
import { rethrowControlFlow } from "./next-control-flow";
import { getRequestHandler } from "./request-handler.server";
import { errorSystem } from "./error-system";
import {
  zodFormValidator,
  toWireFieldErrors,
  isZodSchema,
  type FormValidator,
} from "./form-validator";

// 오버로드 1 — zod 스키마(완전 하위호환). 런타임에서 isZodSchema로 판별돼 zodFormValidator로 감싸진다.
export function safeServerAction<S extends z.ZodTypeAny, R>(
  schema: S,
  action: (data: z.infer<S>) => Promise<R>,
): (raw: z.infer<S>) => Promise<Result<R>>;
// 오버로드 2 — 임의의 동기 FormValidator(validator-agnostic). zod 의존 없이 검증을 주입한다.
export function safeServerAction<TData, R>(
  validator: FormValidator<TData>,
  action: (data: TData) => Promise<R>,
): (raw: unknown) => Promise<Result<R>>;
export function safeServerAction<TData, R>(
  schemaOrValidator: z.ZodTypeAny | FormValidator<TData>,
  action: (data: TData) => Promise<R>,
) {
  const validator: FormValidator<TData> = isZodSchema(schemaOrValidator)
    ? (zodFormValidator(schemaOrValidator) as unknown as FormValidator<TData>)
    : (schemaOrValidator as FormValidator<TData>);

  return async (raw: unknown): Promise<Result<R>> => {
    // Boundary occurrence: an RPC mutation surfaced at the form scope.
    const occurrence = errorSystem.makeOccurrence("unknown", {
      interaction: "mutation",
      uiScope: "form",
    });
    try {
      const validation = validator.parse(raw);
      if (!validation.ok) {
        // Validation failure → finalize to a wire payload through the leak gate(형태 게이트 —
        // 내용 안전성은 FormValidator 신뢰 계약이 담당). finalizeUnknown resolves the decision
        // + payload only — no telemetry runs (Track-1 is never reported).
        return degrade<R>(
          errorSystem.finalizeUnknown(
            makeError({
              code: "VALIDATION",
              details: { fieldErrors: toWireFieldErrors(validation) },
            }),
            occurrence,
            { runtime: "server" },
          ),
        );
      }
      return actionSuccess(await action(validation.data));
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
}
