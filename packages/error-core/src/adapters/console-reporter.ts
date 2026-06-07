// error/adapters/console-reporter.ts — structured console ReporterSink (no SDK).
// (P8 리뷰: 서버 composition root와 앱 composition root가 같은 인라인 sink를 중복 정의하던 것을
//  단일 출처로 복원 — 구 Reporter 기반 createConsoleReporter의 ReporterSink 후계.)
import type { ReporterSink } from "../decision/types";

/** code/level/correlationId/route 구조화 라인 — 서버/dev 기본 모니터링 sink. message/details는 싣지 않는다. */
export const createConsoleReporter = (): ReporterSink => ({
  capture(error, decision, ctx): boolean {
    console.error({
      tag: "[error]",
      code: error.code,
      level: decision.level,
      correlationId: ctx.correlationId,
      route: ctx.route,
    });
    // 캡처 반환 프로토콜: 콘솔 출력은 "원격 관측 시스템 도달"이 아니므로 `false`를 반환한다
    // (types.ts 의미론). 마커의 소비자는 composeBeforeSend(Sentry)뿐이다. OR 집계에서 이 false는
    // 무력(inert)이다 — console-only 개발 배선에선 전송 sink가 없어 composite가 false라 매번
    // 비마킹이어도 무해하고(그 배선엔 Sentry 자동 캡처가 없어 중복 위험 0), Sentry+console
    // 프로덕션 배선에선 Sentry의 true가 OR로 이겨 console의 false가 마킹을 깔아뭉개지 않는다.
    return false;
  },
  breadcrumb() {},
});
