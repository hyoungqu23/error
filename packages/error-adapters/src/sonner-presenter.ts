// error/adapters/sonner-presenter.ts  — the ONLY file that imports the sonner SDK.
// (P6 — 신 Presenter 계약, design §5 / RFC 모듈 맵) Client-only UX sink: caller가
// executeErrorDecision의 반환값(UserErrorDecision)을 건네면 toast로 렌더한다.
// 파이프라인은 Presenter를 호출하지 않는다 — presentation은 소비자/UI의 몫이고,
// 이 파일은 그 소비자가 쓰는 벤더 어댑터다.
//
// Copy는 user.messageKey(disclosure가 반영된 키)를 resolveErrorMessage로 해소
// (host translator → co-located fallback → generic line) — 절대 raw 키를 렌더하지 않는다.
// RATE_LIMITED의 {seconds} 카운트다운(G2/G6): resolve가 messageVars를 중앙 도출하므로
// (resolve.ts — 인스턴스 retryAfterMs 우선, details 힌트 fallback, §5.4) 보통 user.messageVars가
// 채워져 온다. 아래 `??` 체인은 resolve를 거치지 않은 외부 결정 객체를 위한 방어 도출이다.
//
// Dedupe: toast id = error.code — 같은 코드의 폭풍이 한 개의 갱신 토스트로 수렴.
import { toast } from "sonner";
import { retryAfterHintFromError, type Presenter } from "error-core";
import { resolveErrorMessage, type Translator } from "error-core/translator";

export const createSonnerPresenter = (translator?: Translator | null): Presenter => ({
  present(error, user) {
    // Defensive: only toast/dialog reach a user-facing toast surface
    // (구 "toast"/"alert" — 신 ErrorSurface 어휘에서 alert는 dialog).
    if (user.surface !== "toast" && user.surface !== "dialog") return;

    const retryAfterMs = user.retryAfterMs ?? retryAfterHintFromError(error);
    const vars =
      user.messageVars ??
      (retryAfterMs !== undefined ? { seconds: Math.ceil(retryAfterMs / 1000) } : undefined);
    const message = resolveErrorMessage(user.messageKey, translator, vars);

    // Dedupe by code: one toast per code, updated in place on repeats.
    const options = { id: error.code } as const;
    if (user.surface === "dialog") toast.error(message, options);
    else toast(message, options);
  },
});
