// error/adapters/console-reporter.ts — structured console ReporterSink (no SDK).
// (P8 리뷰: 서버 composition root와 앱 composition root가 같은 인라인 sink를 중복 정의하던 것을
//  단일 출처로 복원 — 구 Reporter 기반 createConsoleReporter의 ReporterSink 후계.)
import type { ReporterSink } from "../decision/types";

/** code/level/correlationId/route 구조화 라인 — 서버/dev 기본 모니터링 sink. message/details는 싣지 않는다. */
export const createConsoleReporter = (): ReporterSink => ({
  capture(error, decision, ctx) {
    console.error({
      tag: "[error]",
      code: error.code,
      level: decision.level,
      correlationId: ctx.correlationId,
      route: ctx.route,
    });
  },
  breadcrumb() {},
});
