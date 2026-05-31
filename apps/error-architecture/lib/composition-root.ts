// lib/composition-root.ts — 앱의 컴포지션 루트(DI 경계).
//
// "어떤 어댑터를 쓸지" 결정하는 유일한 장소다. 라이브러리(error-core/-adapters/-next)는
// 계약(Reporter/Presenter/Notifier)만 알고, 구체 벤더 선택은 여기서 한다.
//
//   - 클라이언트 deps : 아래 buildClientDeps()로 조립 — sonner presenter(토스트) +
//                       guarded console reporter. (initHandleError로 1회 바인딩)
//   - 서버 deps       : error-next/server의 serverDeps를 그대로 사용한다
//                       (Sentry+console reporter, pager notifier, 요청별 correlationId).
//                       기본 serverDeps는 모듈 로드 시 Sentry reporter를 eager 조립한다 —
//                       Sentry.init()이 없으면 no-op이다(데모처럼 init 미설정 시 서버 보고는
//                       조용히 비활성). 프로덕션에서는 instrumentation.ts에서 Sentry.init()을
//                       먼저 호출하거나, serverDeps 대신 자체 deps로 교체한다:
//
//                         import { createHandleError, createConsoleReporter,
//                                  guardedCompositeReporter, noopNotifier } from "error-core";
//                         const customDeps = {
//                           registry, presenter: { present() {} }, notifier: noopNotifier,
//                           reporter: guardedCompositeReporter([
//                             { label: "console", reporter: createConsoleReporter() },
//                           ]),
//                         };
//                         const handle = createHandleError(customDeps, ctx);
//
//                       (이 데모는 기본 serverDeps 사용)
import {
  getActiveErrorRegistry,
  guardedCompositeReporter,
  createConsoleReporter,
  noopNotifier,
  type HandleErrorDeps,
} from "error-core";
import { createSonnerPresenter } from "error-adapters/sonner-presenter";

/** 클라이언트 런타임의 deps 묶음. ErrorInit이 initHandleError(buildClientDeps())로 1회 바인딩한다. */
export const buildClientDeps = (): HandleErrorDeps => ({
  registry: getActiveErrorRegistry(),
  reporter: guardedCompositeReporter([{ label: "console", reporter: createConsoleReporter() }]),
  presenter: createSonnerPresenter(), // 사용자 토스트(sonner). 벤더를 아는 유일한 파일은 어댑터.
  notifier: noopNotifier, // 페이징은 서버 런타임의 책임 — 클라에서는 no-op.
});
