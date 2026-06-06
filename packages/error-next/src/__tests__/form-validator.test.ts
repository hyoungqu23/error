// §Phase 0a — zodFormValidator: zod 스키마를 FormValidator 계약으로 감싸는 기본 어댑터.
// safeParse 기반이므로 throw 없이 ok/실패를 정상 분기로 흘리고, 루트 레벨 formErrors는
// formError로 합쳐 올린다. transformed output(z.coerce 등)이 data에 보존되는지도 함께 본다.
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { zodFormValidator, toWireFieldErrors } from "../form-validator";

describe("zodFormValidator — zod → FormValidator 어댑터", () => {
  it("성공 시 ok=true와 파싱된 data를 싣는다", () => {
    const validator = zodFormValidator(z.object({ id: z.string() }));
    const result = validator.parse({ id: "abc" });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.data).toEqual({ id: "abc" });
  });

  it("필드 실패는 fieldErrors로, 루트 실패는 formError로 합류한다", () => {
    // .refine(루트 레벨)이 formErrors를, 개별 필드 실패가 fieldErrors를 만든다.
    const schema = z
      .object({ password: z.string().min(8), confirm: z.string() })
      .refine((d) => d.password === d.confirm, { message: "비밀번호가 일치하지 않습니다." });
    const validator = zodFormValidator(schema);

    const result = validator.parse({ password: "x", confirm: "y" });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    // 필드 레벨 오류(min(8))는 fieldErrors.password에.
    expect(result.fieldErrors.password?.length ?? 0).toBeGreaterThan(0);
    // 루트 레벨 오류(refine)는 formError로 join되어 올라온다.
    expect(result.formError).toContain("비밀번호가 일치하지 않습니다.");
  });

  it("루트 레벨 오류가 없으면 formError 키 자체를 싣지 않는다", () => {
    const validator = zodFormValidator(z.object({ id: z.string().min(1) }));
    const result = validator.parse({ id: "" });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.fieldErrors.id?.length ?? 0).toBeGreaterThan(0);
    expect(result.formError).toBeUndefined();
  });

  it("transformed output(z.coerce)이 data에 보존된다", () => {
    const validator = zodFormValidator(z.object({ count: z.coerce.number().int() }));
    const result = validator.parse({ count: "42" });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    // "42"(string) → 42(number)로 변환된 출력이 그대로 data에 반영된다.
    expect(result.data).toEqual({ count: 42 });
    expect(typeof result.data.count).toBe("number");
  });
});

describe("toWireFieldErrors — _form 합류(P0a 리뷰: 예약 키 보존 병합)", () => {
  it("formError를 _form으로 합류시키고, 어댑터가 이미 채운 _form은 덮어쓰지 않고 concat한다", () => {
    const wire = toWireFieldErrors({
      fieldErrors: { _form: ["field-level _form"], email: ["required"] },
      formError: "root error",
    });
    // 어댑터의 _form(필드 키로 쓴 경우)이 소실되지 않는다 — concat 보존.
    expect(wire._form).toEqual(["field-level _form", "root error"]);
    expect(wire.email).toEqual(["required"]);
  });

  it("formError가 없으면 fieldErrors를 그대로(복사본으로) 반환한다", () => {
    const fieldErrors = { name: ["required"] };
    const wire = toWireFieldErrors({ fieldErrors });
    expect(wire).toEqual({ name: ["required"] });
    expect(wire).not.toBe(fieldErrors); // 입력 비변형(복사본)
  });
});
