"use server";

// app/demo/form-action/actions.ts — 폼 뮤테이션 경계.
// safeFormAction(서버 전용)으로 감싼다:
//   · Zod 파싱 실패        → VALIDATION 비즈니스 에러 → Result.Failure(필드 에러 허용목록 통과)
//   · 비즈니스 throw       → INVALID_CREDENTIALS → Result.Failure(직렬화 안전)
//   · unexpected throw     → 요청별 핸들러로 report 후 re-throw(error.tsx)
// 어떤 경로든 클라이언트에는 free-text message가 아니라 code + userMessageKey만 건너간다.
import { z } from "zod";
import { safeFormAction } from "error-next/server";
import { makeError } from "error-core";

const LoginSchema = z.object({
  email: z.string().email("올바른 이메일 형식이 아닙니다."),
  password: z.string().min(8, "비밀번호는 8자 이상이어야 합니다."),
});

// 데모 자격증명: demo@aents.co / password123
export const loginAction = safeFormAction(LoginSchema, async (data) => {
  if (data.email !== "demo@aents.co" || data.password !== "password123") {
    // 비즈니스(expected) 에러 — Result.Failure로 직렬화되어 클라이언트로 돌아간다.
    throw makeError({ code: "INVALID_CREDENTIALS", details: null });
  }
  return { userId: "u_001", email: data.email };
});
