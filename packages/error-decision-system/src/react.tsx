import type { ErrorDecision } from "./index";

export interface ErrorSurfaceProps {
  decision: ErrorDecision | null | undefined;
  translate: (messageKey: string) => string;
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

export function ErrorSurface({ decision, translate }: ErrorSurfaceProps) {
  if (!decision || decision.user.surface === "silent") return null;

  const message = translate(decision.user.messageKey);
  const support = decision.user.supportCode ? `지원 코드: ${decision.user.supportCode}` : null;

  return (
    <section className={`eds-surface eds-${decision.user.surface}`} data-surface={decision.user.surface}>
      <div>
        <strong>{surfaceTitle(decision.user.surface)}</strong>
        <p>{message}</p>
        {support ? <small>{support}</small> : null}
      </div>
      <span>{actionLabel[decision.user.action]}</span>
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
