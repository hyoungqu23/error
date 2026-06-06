// error/safe-form-action.ts  — the form-mutation boundary, useActionState-compatible.
// Signature is `(prevState, formData) => Promise<Result<R>>` so it composes directly with
// React's useActionState and a progressively-enhanced <form action>. Shares identical
// control-flow + reporting plumbing with safeServerAction; differs only in input
// adaptation (raw FormData → plain object before the validator runs). Validation is
// validator-agnostic: a FormValidator parse-adapter owns coercion/refinement — zod is the
// default (zodFormValidator) but any sync validator composes (이식 설계 §Phase 0a).
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

// 오버로드 1 — zod 스키마(완전 하위호환). 런타임에서 safeParse 보유로 판별돼 zodFormValidator로 감싸진다.
export function safeFormAction<S extends z.ZodType, R>(
  schema: S,
  action: (input: z.infer<S>, prevState: FormState<R>) => Promise<R>,
): (prevState: FormState<R>, formData: FormData) => Promise<Result<R>>;
// 오버로드 2 — 임의의 동기 FormValidator(validator-agnostic). zod 의존 없이 검증을 주입한다.
export function safeFormAction<TData, R>(
  validator: FormValidator<TData>,
  action: (input: TData, prevState: FormState<R>) => Promise<R>,
): (prevState: FormState<R>, formData: FormData) => Promise<Result<R>>;
export function safeFormAction<TData, R>(
  schemaOrValidator: z.ZodType | FormValidator<TData>,
  action: (input: TData, prevState: FormState<R>) => Promise<R>,
) {
  // zod 판별: safeParse 함수 + _def 동시 보유(zod 스키마의 내부 정의 슬롯). safeParse 하나만
  // 보는 구조적 휴리스틱은 우연히 safeParse를 노출하는 커스텀 validator를 zod로 오라우팅할 수
  // 있어(P0a 리뷰) _def를 함께 확인한다. 둘 다 노출하는 비-zod validator는 미지원으로 문서화.
  const validator: FormValidator<TData> = isZodSchema(schemaOrValidator)
    ? (zodFormValidator(schemaOrValidator) as unknown as FormValidator<TData>)
    : (schemaOrValidator as FormValidator<TData>);

  return async (prevState: FormState<R>, formData: FormData): Promise<Result<R>> => {
    // Boundary occurrence: a form submission surfaced at the form scope.
    const occurrence = errorSystem.makeOccurrence("unknown", {
      interaction: "form-submit",
      uiScope: "form",
    });

    let validation: ReturnType<FormValidator<TData>["parse"]>;
    try {
      // Preserve duplicate field names as arrays; the validator owns coercion/refinement.
      validation = validator.parse(formDataToObject(formData));
    } catch (error) {
      // FormValidator.parse는 throw하지 않기로 계약돼 있다(zodFormValidator는 safeParse 사용). 여기서의
      // throw는 어댑터 버그/런타임 fault → unexpected 경로(rethrowControlFlow → report → re-throw).
      rethrowControlFlow(error);
      const handleServerError = await getRequestHandler();
      handleServerError(error);
      throw error;
    }

    if (!validation.ok) {
      // Validation failure → finalize to a wire payload through the leak gate(형태 게이트 —
      // validateDetails는 값이 string[]임만 강제하고 내용은 검사하지 않는다. 내용 안전성은
      // FormValidator 신뢰 계약이 담당). finalizeUnknown resolves the decision + payload only —
      // no telemetry runs (Track-1 is never reported). 루트 오류(formError)는 toWireFieldErrors가
      // 예약 키 _form으로 합류시킨다(zod 경로 포함 — 이전에 조용히 버려지던 루트 오류가 wire에
      // 실리는 **의도된 동작 변경**이며 특성화 테스트로 봉인됨).
      return degrade<R>(
        errorSystem.finalizeUnknown(
          makeError({ code: "VALIDATION", details: { fieldErrors: toWireFieldErrors(validation) } }),
          occurrence,
          { runtime: "server" },
        ),
      );
    }

    try {
      return actionSuccess(await action(validation.data, prevState));
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
}
