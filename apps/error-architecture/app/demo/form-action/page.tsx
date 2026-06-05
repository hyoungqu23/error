"use client";

// app/demo/form-action/page.tsx — useActionState로 safeFormAction을 구동하는 폼.
// Result.Failure는 누출게이트(toClientErrorPayload)를 통과해 건너온 ClientErrorPayload를 담는다
// (free-text message 없음):
//   · code==="VALIDATION" → details.fieldErrors가 allowlist를 통과해 인라인 렌더
//   · 그 외(INVALID_CREDENTIALS 등) → messageKey(+messageVars)를 resolveErrorMessage로 카피 해소
import { useActionState } from "react";
import Link from "next/link";
import { resolveErrorMessage } from "error-next";
import { loginAction } from "./actions";

export default function FormActionDemo() {
  const [state, formAction, isPending] = useActionState(loginAction, null);

  // 주의: 여기서 state.error는 AppError가 아니라 ClientErrorPayload(누출게이트
  // toClientErrorPayload를 통과해 경계를 건너온 plain object, message 없음)다. 따라서 AppError
  // 인스턴스를 받는 fieldErrorsFromError()는 쓸 수 없고, allowlist를 통과한
  // details.fieldErrors를 직접 읽는다. (fieldErrorsFromError는 throw된 AppError용이다.)
  const fieldErrors =
    state && !state.ok && state.error.code === "VALIDATION"
      ? (state.error.details as { fieldErrors?: Record<string, string[]> } | undefined)?.fieldErrors
      : undefined;

  const generalError =
    state && !state.ok && state.error.code !== "VALIDATION"
      ? resolveErrorMessage(state.error.messageKey, null, state.error.messageVars)
      : undefined;

  return (
    <div className="container">
      <p>
        <Link href="/">← 홈</Link>
      </p>
      <h1>뮤테이션 트랙 · safeFormAction</h1>
      <p className="muted">
        데모 자격증명: <code>demo@aents.co</code> / <code>password123</code>. 형식이 틀리면
        VALIDATION 인라인 필드 에러, 자격증명이 틀리면 INVALID_CREDENTIALS Result.Failure.
      </p>

      <form action={formAction} className="card" noValidate>
        <label htmlFor="email">이메일</label>
        <input id="email" name="email" type="email" defaultValue="demo@aents.co" autoComplete="off" />
        {fieldErrors?.email?.map((m) => (
          <p className="field-error" key={m}>
            {m}
          </p>
        ))}

        <label htmlFor="password">비밀번호</label>
        <input id="password" name="password" type="password" defaultValue="" autoComplete="off" />
        {fieldErrors?.password?.map((m) => (
          <p className="field-error" key={m}>
            {m}
          </p>
        ))}

        {generalError && (
          <p className="field-error" style={{ marginTop: 16 }}>
            {generalError}
          </p>
        )}

        {state?.ok && (
          <p style={{ color: "var(--ok)", marginTop: 16 }}>
            <span className="badge ok">성공</span> 로그인됨 — userId={state.data.userId}
          </p>
        )}

        <div className="row" style={{ marginTop: 20 }}>
          <button type="submit" disabled={isPending}>
            {isPending ? "처리 중…" : "로그인"}
          </button>
        </div>
      </form>

      <div className="card">
        <h3 className="muted" style={{ marginTop: 0 }}>이 데모가 보여주는 것</h3>
        <ul className="muted">
          <li>Zod 파싱은 safeFormAction이 소유 → 실패 시 VALIDATION + fieldErrors</li>
          <li>비즈니스 에러는 throw해도 Track-1으로 Result.Failure가 됨(error.tsx로 안 감)</li>
          <li>클라이언트는 code/messageKey/허용된 details만 받음 — message 누출 없음</li>
        </ul>
      </div>
    </div>
  );
}
