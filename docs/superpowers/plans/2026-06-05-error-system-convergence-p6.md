# P6 — error-adapters un-red (+ Presenter 계약·dead-man's-switch 재도입) Implementation Plan

> 순차 TDD. 게이트: **`error-adapters` 전체 typecheck+test green(최초)** + `error-core`/`error-next` green 유지.

**Goal:** P3e 이후 red였던 `sentry-reporter`/`sonner-presenter`를 신 sink 계약으로 재배선하고, RFC 모듈 맵이 error-core 텔레메트리에 명시한 **Presenter 계약**과 **dead-man's-switch(guarded composite)** 를 신 모델 위에 재도입한다. P5 리뷰가 적시한 `serverReporter.health()` 손실도 복원한다.

**Architecture (잠긴 결정):**
- **D-P6-1 (Presenter = 신 모델 3번째 sink 계약, RFC 모듈 맵 96·111행):** `decision/types.ts`에 `Presenter { present(error: AppError, user: UserErrorDecision, ctx: TelemetryContext): void }` 추가. **파이프라인(executeErrorDecision)은 호출하지 않는다** — caller가 반환된 UserErrorDecision을 presenter에 넘기는 소비자 계약(P3b-ii "No Presenter in pipeline" 결정과 양립). 배럴은 decision star로 노출.
- **D-P6-2 (dead-man's-switch 재도입, RFC 모듈 맵 + P3e 이연 노트):** `error-core/src/adapters/composite.ts`를 **ReporterSink 기반**으로 복원 — `guardedCompositeReporter(sinks: LabeledReporter[], opts)` → `GuardedCompositeReporter extends ReporterSink` + `health(): ReporterHealth`. guard 대상은 capture/breadcrumb. emitLastResort(레이트리밋 stderr/console)·failures 계측은 구(2585cbf) 동작 보존. `noopReporter`/`compositeReporter`도 ReporterSink로 복원. `composite.test.ts` 신 시그니처로 재작성. 배럴 노출 복원.
- **D-P6-3 (sentry → ReporterSink):** `report(e,level,ctx)`→`capture(e,decision,ctx)`(level=decision.level), `breadcrumb(e,surface,ctx)`→`breadcrumb(e,decision,ctx)`(surface는 `decision.tags?.surface`로 보존 — resolveTelemetry가 채움). fingerprint는 `decision.fingerprint ?? [error.code]`. tags.expected는 `isKnownErrorCode && category==="business"`. `toSentryLevel`은 TelemetryDecision["level"] 4-유니온으로 단순화("none" 분기 제거). `SentryReporter extends ReporterSink`(+setUser/setContext/droppedTotal 유지). gateClientDetails의 ugly cast를 isKnownErrorCode+ErrorSemantics로 정리(P3c 이연). storm throttle/PII scrub/sentryBeforeSend 불변.
- **D-P6-4 (sonner → Presenter):** `createSonnerPresenter(translator?): Presenter`. surface 게이트: `"toast" | "dialog"`(구 "toast"/"alert" 대응 — ErrorSurface에 alert 없음, dialog가 toast.error). 메시지: `resolveErrorMessage(user.messageKey, translator, vars)` — **vars = user.messageVars ?? seconds 도출**(`user.retryAfterMs ?? retryAfterHintFromError(error)` → `{seconds: ceil(ms/1000)}`). resolve.ts가 아직 messageVars를 생성하지 않으므로(확인됨) sink 도출로 구 G2/G6 보간을 보존하되, 향후 resolve가 채우면 자동 우선. dedupe id = error.code 유지.
- **D-P6-5 (serverReporter 업그레이드):** error-next `request-handler.server.ts`의 인라인 serverReporter를 `guardedCompositeReporter([{label:"console", reporter: <인라인 console ReporterSink>}])`로 교체 — `health()` 복원(P8 health route 대비, P5 리뷰 [9] 손실 복원). G10 배선 주석 복원.

## Tasks
- **T1 (error-core):** decision/types.ts에 Presenter 추가(D-P6-1).
- **T2 (error-core):** adapters/composite.ts 복원(D-P6-2) + composite.test.ts 재작성(구 테스트를 `git show 2585cbf`로 참조, Reporter→ReporterSink: report→capture(decision), breadcrumb 3-인자) + index.ts 배럴 복원. 게이트: error-core green.
- **T3 (error-adapters):** sentry-reporter.ts 재배선(D-P6-3). sentry-reporter.test.ts는 sentryBeforeSend 위주라 거의 무변경(import 확인만).
- **T4 (error-adapters):** sonner-presenter.ts 재배선(D-P6-4) + sonner-presenter.test.ts 재작성(present(error, user, ctx) — UserErrorDecision 리터럴/“alert”→“dialog”/non-presenter surfaces no-op 유지/보간·dedupe·translator 케이스 보존).
- **T5 (error-next):** request-handler serverReporter → guarded composite(D-P6-5). error-next 게이트 유지 확인.
- **T6:** 최종 게이트(3패키지) + 적대적 리뷰 워크플로우.

## Self-Review
- RFC 모듈 맵(96·107-111행) 충족: ReporterSink/NotifierSink/Presenter + dead-man's-switch(코어), adapters 3종이 각 계약 구현. ✓
- handoff P6 항목: "sonner-presenter를 decision messageKey 경로로"(user.messageKey — disclosure 반영 키), "sentry 로컬 게이트 정리" ✓.
- 파이프라인 불변: executeErrorDecision은 여전히 reporter/notifier만 — Presenter는 caller 계약(서명만 코어). ✓
- breadcrumb surface 보존: TelemetryDecision.tags.surface(resolve가 채움) 경유 — ReporterSink 계약 변경 없음. ✓
- apps(P8) 대비: serverReporter.health() 복원으로 health route 재배선 준비 완료. ✓
