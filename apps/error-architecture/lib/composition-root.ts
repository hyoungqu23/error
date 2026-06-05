"use client";

// lib/composition-root.ts — 앱의 클라이언트 컴포지션 루트(DI 경계).
//
// "어떤 어댑터를 쓸지" 결정하는 유일한 장소다. 라이브러리(error-core/-adapters/-next)는
// 계약(ReporterSink/Presenter/NotifierSink)만 알고, 구체 벤더 선택은 여기서 한다.
//
//   - 클라이언트 deps : buildClientDeps() — guarded console ReporterSink + noop notifier.
//                       정책은 주입된 DecisionSystem(error-next의 baseline errorSystem)이
//                       전부 소유한다(P3e 이후 active-registry 없음).
//   - 토스트(Presenter): 신 모델에서 Presenter는 파이프라인이 호출하지 않는 **소비자 계약**이다 —
//                       handleError가 반환한 decision.user를 presentFailure()로 sonner presenter에
//                       넘긴다(아래). "telemetry는 파이프라인, presentation은 소비자"의 레퍼런스 배선.
//   - 서버 deps       : 이 파일을 거치지 않는다 — error-next/server의 serverDeps를 직접
//                       import해 사용한다(guarded console
//                       reporter + health(), pager notifier, 요청별 correlationId). 프로덕션에서
//                       Sentry를 쓰려면 instrumentation.ts에서 Sentry.init({ beforeSend:
//                       sentryBeforeSend })를 호출하고 createSentryReporter()를 guarded
//                       composite의 sink로 추가해 자체 deps로 교체한다. (이 데모는 기본 사용)
import {
  clientErrorSystem,
  guardedCompositeReporter,
  createConsoleReporter,
  type HandleErrorDeps,
  type DecisionFailure,
} from "error-next";
import { createSonnerPresenter } from "error-adapters/sonner-presenter";

/** 클라이언트 런타임의 deps 묶음. ErrorInit이 initHandleError(buildClientDeps(), { correlationId })로 1회 바인딩한다. */
export const buildClientDeps = (): HandleErrorDeps => ({
  // 클라 fallback은 UNKNOWN_CLIENT_ERROR(clientErrorSystem) — 브라우저 unknown을 서버 fault로 안 보냄.
  system: clientErrorSystem,
  reporter: guardedCompositeReporter([{ label: "console", reporter: createConsoleReporter() }]),
  notifier: { alert() {} }, // 페이징은 서버 런타임의 책임 — 클라에서는 no-op.
});

/** 사용자 토스트(sonner). 벤더를 아는 유일한 파일은 어댑터 — 여기서는 조립만 한다. */
const clientPresenter = createSonnerPresenter();

/** handleError가 돌려준 결정의 user 면을 Presenter로 — 신 모델의 presentation 소비 지점. */
export const presentFailure = (failure: DecisionFailure): void => {
  clientPresenter.present(failure.error, failure.decision.user, {
    runtime: "client",
    operation: failure.occurrence.operation,
  });
};
