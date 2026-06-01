import type { ReactNode } from "react";
import type { ErrorDecision, ErrorSurface as ErrorSurfaceKind, UserErrorDecision } from "./index";

// Note: this module is intentionally hook-free so `ErrorSurface` stays usable in React Server
// Components. Client-only hooks (useFormAction / useDecisionQuery) live in `./react-hooks`.

export interface SurfaceSlotProps {
  decision: UserErrorDecision;
  message: string;
  actionLabel: string;
  fieldErrors?: Record<string, string[]>;
}

export type SurfaceSlots = Partial<Record<ErrorSurfaceKind, (props: SurfaceSlotProps) => ReactNode>>;

export interface ErrorSurfaceProps {
  decision: ErrorDecision | null | undefined;
  translate: (messageKey: string) => string;
  /**
   * Per-surface render overrides. The decision picks the surface; the slot only renders it.
   * Anything not supplied falls back to the built-in default renderer.
   */
  slots?: SurfaceSlots;
  /** Allowlisted, client-safe details (e.g. validation fieldErrors) to hand to the slot. */
  details?: unknown;
}

const actionLabel: Record<string, string> = {
  "fix-input": "입력 수정",
  retry: "다시 시도",
  login: "로그인",
  "request-access": "권한 요청",
  "choose-different-option": "다른 선택",
  wait: "기다리기",
  "go-back": "뒤로 가기",
  "contact-support": "지원 문의",
  none: "추가 행동 없음",
};

export const extractFieldErrors = (details: unknown): Record<string, string[]> | undefined => {
  if (typeof details !== "object" || details === null) return undefined;
  const candidate = (details as { fieldErrors?: unknown }).fieldErrors;
  if (typeof candidate !== "object" || candidate === null) return undefined;
  return candidate as Record<string, string[]>;
};

export function ErrorSurface({ decision, translate, slots, details }: ErrorSurfaceProps) {
  if (!decision || decision.user.surface === "silent") return null;

  const message = translate(decision.user.messageKey);
  const label = actionLabel[decision.user.action] ?? decision.user.action;
  const fieldErrors = extractFieldErrors(details);

  const slot = slots?.[decision.user.surface];
  if (slot) {
    return <>{slot({ decision: decision.user, message, actionLabel: label, fieldErrors })}</>;
  }

  const support = decision.user.supportCode ? `지원 코드: ${decision.user.supportCode}` : null;

  return (
    <section className={`eds-surface eds-${decision.user.surface}`} data-surface={decision.user.surface}>
      <div>
        <strong>{surfaceTitle(decision.user.surface)}</strong>
        <p>{message}</p>
        {fieldErrors ? (
          <ul className="eds-field-errors">
            {Object.entries(fieldErrors).flatMap(([field, errors]) =>
              (errors ?? []).map((error, index) => (
                <li key={`${field}-${index}`}>
                  <span className="eds-field-name">{field}</span>: {error}
                </li>
              )),
            )}
          </ul>
        ) : null}
        {decision.user.target ? <small className="eds-target">대상: {decision.user.target}</small> : null}
        {support ? <small>{support}</small> : null}
      </div>
      <span>{label}</span>
    </section>
  );
}

const surfaceTitle = (surface: ErrorDecision["user"]["surface"]): string => {
  switch (surface) {
    case "field":
      return "필드 오류";
    case "form":
      return "폼 오류";
    case "inline":
      return "영역 오류";
    case "empty":
      return "비어 있음";
    case "toast":
      return "알림";
    case "dialog":
      return "확인 필요";
    case "page":
      return "페이지 오류";
    case "redirect":
      return "이동 필요";
    case "silent":
      return "표시 안 함";
  }
};
