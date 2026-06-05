# P8 — apps 도그푸딩 + 구 시스템 은퇴 + 문서 단일화 (수렴 종결) Implementation Plan

> 마지막 phase. 게이트: **워크스페이스 전체** `pnpm turbo run typecheck test lint` — 필터 없이 전부 green(수렴 완료의 정의).

**Goal:** apps/error-architecture를 신 decision 표면으로 재배선(un-red — 잔여 6파일/17에러), `error-decision-system` 패키지와 데모 앱 2개를 은퇴(삭제), lint/CI를 워크스페이스 전체로 편입, README를 단일 정체성으로 갱신한다.

**Architecture (잠긴 결정):**
- **D-P8-1 (errorSystem 공개):** error-next 배럴에 `export { errorSystem }` 추가 — host가 자기 `HandleErrorDeps`를 구성하는 D-P5-1의 P8 연장(상위호환). client-safe.
- **D-P8-2 (composition-root 재배선 + 신모델 토스트 배선):** `buildClientDeps() = { system: errorSystem, reporter: guardedCompositeReporter([console ReporterSink]), notifier: noop }`(registry/presenter 필드 제거). **Presenter는 파이프라인 밖 소비자 계약**이므로 토스트는 `clientPresenter = createSonnerPresenter()` + `presentFailure(failure: DecisionFailure)` 헬퍼로 배선 — `handleError` 반환의 `decision.user`를 presenter에 넘기는 신 모델 정석을 도그푸딩으로 시연.
- **D-P8-3 (error-init):** `initHandleError(buildClientDeps(), { correlationId })` 신 시그니처. initBrowserBoundary 유지.
- **D-P8-4 (demo 재배선):** server-retry/actions(`isDomainError`→`isAppError`, catch unknown narrow), query-retry(`isAppError` narrow가 null도 거름 → TS18047 해소; 메시지는 ErrorFallback 패턴 — `isKnownErrorCode`+catalog `defaultMessageKey`; "핸들러로 보내기" 버튼은 `presentFailure(handleError(error))`로 토스트 시연 복원), form-action(`userMessageKey`→`messageKey` + ClientErrorPayload 주석).
- **D-P8-5 (lint/CI 전체 편입):** eslint files 글롭에 `apps/error-architecture/**/*.{ts,tsx}` 포함(ignores에서 제거), 벤더 허용 오버라이드 추가 — `apps/error-architecture/app/providers.tsx`(Toaster 마운트) + `instrumentation*`만. (composition-root.ts는 raw sonner가 아니라 어댑터만 import하므로 허용 불필요 — 구현 중 정정, P8 리뷰 확정.) error-architecture-app에 lint 스크립트. CI `--filter` 제거 → 워크스페이스 전체 게이트.
- **D-P8-6 (은퇴):** `packages/error-decision-system` + `apps/error-decision-next` + `apps/error-decision-vite` 삭제(외부 참조 0 확인됨 — 데모 앱 2개만 import). pnpm install로 lockfile 정리. eslint ignores/CI 주석에서 은퇴 항목 제거. error-core 주석의 "출처: error-decision-system/..." 표기는 이식 역사 기록으로 유지.
- **D-P8-7 (README 단일화):** 신 모델 어휘로 갱신 — decision 카탈로그(CANONICAL_ERROR_SEMANTICS) SSOT, 단일 누출게이트(toClientErrorPayload), 3-sink 계약(ReporterSink/Presenter/NotifierSink), 수렴(P0–P8) 완료 명시. 은퇴 패키지 언급 제거.

## Tasks
- **T1:** D-P8-1~4 — error-architecture typecheck green.
- **T2:** D-P8-6 은퇴 삭제 + lockfile.
- **T3:** D-P8-5 lint/CI 전체 편입 → `turbo run lint` 전체 green.
- **T4:** D-P8-7 README.
- **T5:** 전체 게이트(필터 없는 turbo typecheck/test/lint) + 적대적 리뷰.

## Self-Review
- handoff P8 항목 전부 매핑: 도그푸딩(T1)·error-decision-system+데모 은퇴(T2)·README 단일화(T4). ✓
- health route는 P6의 serverReporter.health() 복원으로 이미 green — 재배선 불필요(확인만). ✓
- P5 리뷰가 열거한 P8 표면(ErrorRegistryProvider/toErrorResponse 소비처): error-architecture grep 결과 직접 소비 없음 — composition-root/error-init만이 실제 마이그레이션 지점. ✓
- 신 모델 토스트 배선(D-P8-2)은 RFC "Presenter는 소비자 계약" 원칙의 레퍼런스 구현이 된다. ✓
