# Error Decision System Review Notes

작성일: 2026-06-01

이 문서는 `ERROR_DECISION_SYSTEM.md`, `NEW.md`, `NEW_DX.md`, `packages/error-decision-system`, 그리고 데모 앱을 기준으로 Claude 리뷰와 Codex 재리뷰를 합친 기록이다.

## 평가 요약

설계 사고방식은 높게 평가한다. 에러를 단순한 예외 처리나 코드 분류가 아니라, 실패한 사용자 작업에 대해 사용자 표현과 운영 신호를 결정하는 문제로 옮긴 점이 핵심 강점이다. 특히 `semantics`, `occurrence`, `operation`, `boundary`, `ErrorDecision`을 분리한 구조는 제품 에러 시스템으로 확장할 수 있는 좋은 기반이다.

구현은 데모로서는 설계 의도를 잘 보여주지만, 프로덕션 라이브러리 관점에서는 몇 가지 보증이 부족했다. 가장 큰 문제는 결정이 산출되어도 타입, 메시지, telemetry 실행 단계에서 충분히 강제되지 않는다는 점이었다.

## Claude 리뷰 핵심

- 설계/사고방식: 8.5/10.
- 현재 구현물: 5.5/10.
- `operation`을 1급 시민으로 둔 점이 가장 큰 설계 자산이다.
- 같은 에러 코드라도 operation과 occurrence에 따라 surface/action/telemetry가 달라져야 한다는 관점이 좋다.
- serialization boundary에서 allowlist 기반 details만 client로 보내는 점은 강하다.
- 다만 disclosure가 권고 수준이고 message copy를 구조적으로 강제하지 못한다.
- resolver가 `AUTH_REQUIRED`, `FORBIDDEN`, `NOT_FOUND` 같은 특정 code를 하드코딩한다.
- operation이 raw string이라 SSOT 타입이 호출부까지 전파되지 않는다.
- sampling은 결정되지만 실행 책임이 불명확하다.
- `important ? "warning" : "warning"` 같은 잔여 구현 버그가 있다.

## Codex 재리뷰 핵심

Claude의 큰 방향에 동의한다. 다만 몇 항목은 우선순위를 조정했다.

가장 중요한 구현 결함은 boundary helper의 precedence였다. `makeOccurrence()`가 `operationMeta.defaultUiScope`를 `BoundaryDefaults.uiScope`보다 우선해, background boundary 안에서 실행한 operation도 operation registry의 UI scope를 따라갈 수 있었다. Boundary는 실패 사건이 들어온 문맥을 설명하는 계층이므로, helper가 제공하는 interaction/uiScope는 operation default보다 우선해야 한다.

두 번째 핵심 결함은 disclosure와 message selection의 분리였다. `safe-vague`, `generic`, `support-only` 같은 disclosure를 결정해도 실제 `messageKey`는 `defaultMessageKey`를 그대로 통과했다. 이 구조에서는 보안/제품 정책이 copy discipline에 의존한다.

세 번째로, resolver의 code 하드코딩은 데모 catalog에는 맞지만 앱별 확장에는 약하다. code별 action/surface 특성은 가능하면 `ErrorSemantics`의 데이터로 이동해야 한다.

네 번째로, operation typed union은 런타임 검증만으로는 부족하다. 데모에서는 `createDecisionSystem()`이 catalog key를 보존해 feature facade에서 unknown operation을 컴파일 타임에 막아야 한다.

## 반영한 변경

- `createDecisionSystem()`을 catalog generic 기반으로 바꿔 operation key를 feature facade까지 전파한다.
- `makeOccurrence()` precedence를 boundary defaults 우선으로 수정했다.
- `ErrorSemantics`에 disclosure별 `messageKeys`와 resource/scope/surface 기반 decision hint를 추가했다.
- `resolveAction()`과 `resolveSurface()`의 주요 code 하드코딩을 semantics metadata 기반으로 옮겼다.
- `DomainError`가 occurrence override를 운반할 수 있게 해, thrown error 경로에서도 resource 같은 사건 문맥을 보존한다.
- `executeTelemetryDecision()`에서 `sampleRate`를 capture 실행에 반영한다.
- operational telemetry level의 no-op 삼항을 수정했다.
- 데모에 search empty state 시나리오를 추가했다.
- Vite/Next 데모 화면에 disclosure, message key, telemetry level, sample 정보를 노출했다.

## 2차 재평가 후 반영 (프로덕션 라이브러리 재스코어링)

7개 차원 적대적 리뷰(종합 5.3/10, 설계 8.0 · 구현 6.0)에서 확인된 발견사항 #2~#7을 코드로 반영했다. 배포/패키징(#1)은 사내 packages 사용 전제라 범위에서 제외했다.

- **#2** `defineFormAction(operation, schema, handler)` 3-arg 오버로드 + `InputSchema`(zod 호환) + `validationErrorCode`. parse 실패 시 client-safe `fieldErrors`로 VALIDATION decision 변환.
- **#3** `defineServerAction` / `defineRouteGuard` / `withRenderBoundary` / `executeErrorDecision` 구현. `ErrorSurface`에 `slots` / `fieldErrors` / `target` 지원, `useFormAction` · `useDecisionQuery` hook 추가. `useErrorDecision`(raw error를 client에서 직접 resolve)만 React context 주입 설계가 필요해 로드맵으로 명시.
- **#4** `OccurrenceContext.idempotent`를 `resolveAction`/`resolveSurface`에 연결. 비-idempotent 재시도는 `wait`로 다운그레이드되고 confirm `dialog` surface로 도달(중복 결제 방지). `dialog` surface 도달 불가 문제 해소.
- **#5** `createDecisionSystem`에 catalog invariant 검증 추가 — 도달 가능한 disclosure level별 messageKey 누락 / fallbackErrorCode 부재를 init time에 throw. `validateMessageKeys: false`로 opt-out.
- **#6** 테스트 38개로 확대(13 → 38): precedence 구별, sampler 주입 계약, presenter no-reinterpret, 시나리오 매트릭스 snapshot, 3-arg schema, idempotent, boundary helper, registry invariant.
- **#7** 시나리오 매트릭스 정합 — TIMEOUT은 form에서 safe-vague(catalog), SCHEMA_MISMATCH는 support-only로 문서 정정, matrix snapshot 테스트로 고정.

## 3차 반영 (잔여 갭 처리)

- **per-code details 타입(DX-3)**: `ErrorSemantics<Code, Details>` + `validateDetails`를 type-guard로 승격, `DetailsOf<Errors, C>` 추출, catalog-typed `decisionSystem.fail`/`appError` 추가. `fail("INVALID_CREDENTIALS", {x})`가 컴파일 에러임을 `@ts-expect-error` 테스트로 고정.
- **useErrorDecision + redirect(6단계)**: `DecisionSystemProvider` + `useErrorDecision(error, occurrence)`, `useDecisionRedirect(decision, navigate)` 추가. `ErrorSemantics.redirectTarget` + `resolveTarget`(field→fieldPath, redirect→redirectTarget)으로 redirect target 결정. 테스트로 고정.
- **B3 풋건**: `finalizeFailure`가 `appError`에 `occurrence`를 넘기지 않게 해 fieldPath발 `uiScope:"field"`가 재병합에 덮이지 않도록 수정 + precedence 테스트.
- 테스트 38 → **43개**.

## 알려진 한계 / 의도적 보류 (기록)

다음 두 항목은 인지된 상태로 **의도적으로 보류**한다. 현재 보안/동작상 실문제가 아니며, 향후 필요 시 별도 과제로 처리한다.

1. **thrown `appError` code narrowing.** free `fail`/`appError`는 확장용으로 `<C extends string>`을 유지해 느슨하다. 코드/details 타입 강제는 catalog-typed `decisionSystem.fail`/`appError`에만 존재한다. throw 경로(특히 `appError`를 던지는 query/route guard)의 code를 호출부에서 catalog로 좁히려면 추가 API가 필요하다. → 추가 API 설계 시 처리.

2. **변수-widening + nested allowlist (SEC-4).** 사전 바인딩된 변수의 *추가* 속성은 표준 TypeScript 동작상 excess-property check를 통과한다(객체 리터럴만 차단). 단 코어 details shape(필수 필드 누락/오타)는 여전히 컴파일 타임에 거부되고, 런타임 `detailsAllowlist`(top-level)가 비허용 필드를 직렬화 전 제거하므로 **실누수가 아니다**. nested object 내부까지 차단하는 `pickAllowlistedDetails` 강화는 SEC-4 별도 과제로 남긴다.

## 별도 협의 / 범위 외

- **`error-core` 통합**: `error-core`(+adapters+next, 329 테스트)와 decision-system의 `DomainError`/`Result`/registry 일원화. 사용자 결정으로 **보류**(별도 RFC/협의 후 진행).
- **`ErrorSurface` field 컴포넌트 매핑**: 현재 slots/fieldErrors 렌더까지 제공. field별 실제 input 연결은 앱 책임.
- **배포/패키징(#1)**: 사내 packages 사용 전제로 의도적 제외.
