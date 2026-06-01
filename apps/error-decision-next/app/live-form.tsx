"use client";

import { useState } from "react";
import { loginAction, translate } from "error-decision-system/demo";
import { ErrorSurface } from "error-decision-system/react";
import { useFormAction } from "error-decision-system/react-hooks";

// A "use client" island rendered by the server component page. Proves the RSC boundary:
// ErrorSurface ("error-decision-system/react", hook-free) renders in both server and client,
// while useFormAction ("error-decision-system/react-hooks", "use client") drives interaction.
export function LiveForm() {
  const form = useFormAction(loginAction);
  const [email, setEmail] = useState("");
  const emailErrors = form.fieldError("email");

  return (
    <section className="live-form">
      <h3>Live: useFormAction(loginAction)</h3>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void form.submit({ email });
        }}
      >
        <input
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="이메일 (@ 없으면 VALIDATION, 있으면 INVALID_CREDENTIALS)"
          aria-label="email"
        />
        <button type="submit" disabled={form.isPending}>
          {form.isPending ? "확인 중…" : "로그인"}
        </button>
      </form>
      {emailErrors ? (
        <ul className="eds-field-errors">
          {emailErrors.map((message, index) => (
            <li key={index}>{message}</li>
          ))}
        </ul>
      ) : null}
      <ErrorSurface decision={form.errorDecision} translate={translate} />
    </section>
  );
}
