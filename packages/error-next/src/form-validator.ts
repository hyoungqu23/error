// error/form-validator.ts — FormValidator 계약: safeFormAction/safeServerAction의 검증을
// zod에서 분리하는 parse-어댑터.
// 계약(이식 설계 §Phase 0a): 동기 우선(비동기 validator는 어댑터가 흡수하지 않는다 — 폼 경계는 동기 검증),
// 어댑터 내부 throw는 safe-* 경계가 unexpected 경로로 정규화한다.
import type { z } from "zod";

/**
 * 신뢰 경계(P0a 리뷰): fieldErrors/formError의 문자열은 누출 게이트의 **콘텐츠 검사 없이**
 * 클라이언트 wire(details.fieldErrors)로 verbatim 전송된다 — catalog의 validateDetails는
 * 형태(값이 string[])만 강제한다. 따라서 어댑터는 반드시 **사용자-대면 안전 카피**만 실어야
 * 하며 서버 내부 정보(스택/내부 ID/raw 입력 echo)를 담아선 안 된다.
 *
 * `_form`은 루트-레벨 오류 전용 **예약 키**다 — safe-* 경계가 formError를 fieldErrors._form으로
 * 합류시킨다(어댑터가 fieldErrors._form을 직접 채운 경우 concat으로 보존 병합).
 */
export type FormValidationResult<TData> =
  | { ok: true; data: TData }
  | { ok: false; fieldErrors: Record<string, string[]>; formError?: string };

export interface FormValidator<TData> {
  /** 입력은 경계가 결정한다 — 폼 경계는 FormData를 객체로 펴서, RPC 경계는 raw 값을 그대로 건넨다. */
  parse(input: unknown): FormValidationResult<TData>;
}

/**
 * zod 스키마 판별 — safeParse 함수 + `_def`(zod의 내부 정의 슬롯) 동시 보유로 판별한다.
 * safeParse 하나만 보는 구조적 휴리스틱은 우연히 safeParse를 노출하는 커스텀 validator를
 * zod로 오라우팅할 수 있다(P0a 리뷰). 둘 다 노출하는 비-zod validator는 미지원.
 */
export const isZodSchema = (value: unknown): value is z.ZodType =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { safeParse?: unknown }).safeParse === "function" &&
  "_def" in value;

/**
 * zod 스키마를 FormValidator로 감싸는 기본 어댑터. safeParse를 사용하므로(throw 없음) 실패는
 * 정상 분기로 흐른다. 실패 시 error.flatten()의 fieldErrors를 그대로 싣고, 루트 레벨 formErrors가
 * 비어있지 않으면 join(" ")하여 formError로 옮긴다(safe-* 경계가 _form 키로 wire에 합류).
 */
export const zodFormValidator =
  <S extends z.ZodType>(schema: S): FormValidator<z.infer<S>> => ({
    parse(input) {
      const parsed = schema.safeParse(input);
      if (parsed.success) return { ok: true, data: parsed.data };
      const { fieldErrors, formErrors } = parsed.error.flatten();
      return {
        ok: false,
        fieldErrors: fieldErrors as Record<string, string[]>,
        ...(formErrors.length > 0 ? { formError: formErrors.join(" ") } : {}),
      };
    },
  });

/**
 * validation 실패를 VALIDATION details의 wire 형태로 변환한다 — catalog의 validateDetails
 * (값 string[] 강제)와 allowlist(["fieldErrors"])를 통과해 wire로 나가는 형태는 fieldErrors
 * 하나뿐이므로, 루트 오류(formError)도 동일 맵의 예약 키 `_form`으로 실어 보낸다.
 * 어댑터가 이미 `_form`을 필드 키로 채웠다면 덮어쓰지 않고 concat으로 보존 병합한다(P0a 리뷰).
 */
export const toWireFieldErrors = (validation: {
  fieldErrors: Record<string, string[]>;
  formError?: string;
}): Record<string, string[]> => {
  const fieldErrors: Record<string, string[]> = { ...validation.fieldErrors };
  if (validation.formError !== undefined) {
    fieldErrors._form = [...(fieldErrors._form ?? []), validation.formError];
  }
  return fieldErrors;
};
