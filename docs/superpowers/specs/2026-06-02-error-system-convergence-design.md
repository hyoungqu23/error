# RFC: Error System 수렴 (Convergence) 설계

- 상태: Draft (검토 대기)
- 작성일: 2026-06-02
- 범위: `packages/error-core`, `packages/error-adapters`, `packages/error-next`, `packages/error-decision-system` 및 `apps/*`
- 선행 문서: `NEW.md`, `NEW_DX.md`, `ERROR_DECISION_SYSTEM.md`, `ERROR_DECISION_SYSTEM_REVIEW.md`

---

## 1. 배경 / 문제

이 레포에는 현재 **두 개의 분리된(disjoint) 에러 시스템**이 병존한다.

**구 스택 (메커니즘 중심, 검증됨)**

```
error-core (커널, zod) → error-adapters (Sentry/sonner/pager) → error-next (Next 통합)
                                                              → apps/error-architecture (레퍼런스 앱)
```

**신 시스템 (정책 중심, demo)**

```
error-decision-system (독립, peer: react) → apps/error-decision-next
                                          → apps/error-decision-vite
```

`error-decision-system`은 `error-core/error-next/error-adapters`를 **소스에서 단 한 줄도 import 하지 않는다**(확인: 이전 grep 히트는 전부 `.next` 빌드 산출물). 두 의존성 그래프는 완전히 분리되어 있다.

이로 인해 레포는 **이중 정체성** 상태다.

- `README.md`와 루트 `package.json`은 여전히 **구 스택만** 레포 정체성으로 설명한다(신 시스템 언급 없음).
- 최근 커밋(2026-06-02)은 전부 신 시스템만 건드린다.
- `DomainError` / `Result` / registry 개념을 **양쪽이 각자 다르게** 정의한다.
  - 구: `DomainError<C extends ErrorCode>` — 런타임 active-registry를 읽음.
  - 신: `DomainError<C extends string>` — 결정 엔진 스코프.
  - → **호환 불가**. 이 중복이 부채의 핵심이다.

`ERROR_DECISION_SYSTEM_REVIEW.md`는 이 둘의 통합("error-core 통합")을 **"별도 협의 / 범위 외 — 보류(별도 RFC 후 진행)"**로 명시했다. 이 RFC가 그 보류된 RFC다.

## 2. 목표 / 비목표

### 2.1 동기 — "정책 레이어 vs 메커니즘 레이어"

이 RFC의 출발점은 다음 인식이다. 두 시스템은 **경쟁자가 아니라 같은 문제의 다른 레이어**다.

| | 정책 레이어 (무엇을 할지 *결정*) | 메커니즘 레이어 (실제로 잡고·나르고·실행) |
|---|---|---|
| **구 스택** | 🔴 약함 — flat `ErrorMeta`의 `present/log/severity` (NEW.md가 비판한 그것) | 🟢 강함 — 검증됨 (transport/normalize/vendor/framework/retry) |
| **신 시스템** | 🟢 강함 — 결정 엔진 (`resolveErrorDecision`) | 🔴 거의 없음 — sink 인터페이스만 |

신 시스템은 **더 나은 엔진**이다. `NEW.md`가 옳게 진단했듯 "에러 코드 하나가 surface와 telemetry를 단독 결정"하는 구 모델은 제품이 커지면 무너진다. 신 결정 엔진은 occurrence·semantics·operation을 입력으로 user/telemetry 결정을 분리 산출하는 상위호환 모델이다.

하지만 신 시스템은 **프로덕션 미완성(incomplete)이지 불능(incapable)이 아니다**. 프로덕션 앱이 필요로 하는 메커니즘 레이어(networkBoundary, retry 실행, wire 재수화, 실제 벤더 어댑터, Next 통합)가 인터페이스로만 존재한다 — 이는 결함이 아니라 **스코프 선택**이다. 그리고 그 메커니즘은 이미 구 스택에 테스트와 함께 존재한다.

→ 따라서 올바른 방향은 "더 나은 신 시스템으로 구 시스템을 대체"가 아니라 **신 시스템의 우수한 정책 레이어를 구 스택의 검증된 메커니즘 레이어에 이식(수렴)**하는 것이다.

> 이 프레이밍을 RFC 본문에 명시하는 이유: 안 그러면 이 문서를 다음에 읽는 사람도 "더 나은 신 시스템인데 왜 구 걸 안 버리지?"라고 똑같이 묻게 된다.

### 2.2 목표

1. **하나의 통합 에러 시스템.** `DomainError`/`Result`/registry를 단일 모델로 통합한다.
2. **결정 엔진을 단일 정책 해소자로.** `resolveErrorDecision`이 모든 정책 결정의 단일 권위가 된다. 구 `resolvePolicy`/flat `ErrorMeta`는 제거한다.
3. **검증된 메커니즘 코드 보존.** transport/retry/normalization/rehydration/vendor 어댑터/Next 통합은 로직 유지, 인터페이스만 통합 커널에 맞춰 재배선한다.
4. **정책을 리뷰 가능한 데이터 + 가드레일로.** 숨은 if문·ad-hoc toast를 lint로 막고, 정책을 카탈로그 데이터로 노출한다.

### 2.3 비목표 (Out of Scope)

- **Multi-platform**: 웹 전용. Mobile/CLI/Admin 같은 non-web 소비자는 가정하지 않는다 (YAGNI). "`surface`/`target`은 와이어를 건너지 않고 클라이언트가 재결정한다"는 원칙만 문서화하고, platform-aware presentation 시임은 만들지 않는다.
- **외부 배포 / 퍼블리시**: 사내 workspace 패키지 전제. npm 퍼블리시·버저닝 정책은 범위 외.
- **Per-request 멀티테넌트**: 정적 카탈로그 하나. 요청별 레지스트리 교체는 제거한다(§3 참조).

## 3. 결정된 전제

이 RFC를 작성하기 전 다음이 합의되었다.

| 결정 | 값 | 근거 |
|---|---|---|
| 프로덕션 소비자 | **없음 — clean break 가능** | 모두 private 데모/레퍼런스. 이상적 최종 형태에 집중 |
| 레지스트리 모델 | **정적 카탈로그 하나** (ALS/active-registry 제거) | 멀티테넌트 요구 없음. 신 엔진의 순수성 철학과 정합. 카탈로그는 `createDecisionSystem(catalog)` 생성 인자로 명시 주입 → 앰비언트 전역 없음, 교차 요청 누출 구조적 불가능 |
| 프레임워크 타겟 | **무관 코어 + Next 어댑터 + 제네릭 React** | 신 시스템이 이미 프레임워크 무관. SPA(Vite) 증명 유지 |
| 수렴 접근법 | **Approach 1 — 제자리 진화** | 검증된 코드 보존, 보류 RFC 방향과 일치, 위험 단계 분산 |
| 가드레일 범위 | **풀 가드레일 + CI** | 문서가 가드레일을 일급으로 다룸 |
| 이행 방식 | **단계적 6+Phase staged** | clean break여도 회귀 방지 + 리뷰 가능성. 각 단계 테스트 green 유지 |

## 4. 목표 아키텍처 / 패키지 토폴로지

```
error-core  (프레임워크 무관 커널 — 단일 진실의 원천)
  │  · 통합 데이터 모델: DomainError · Result · 정적 카탈로그
  │  · 결정 엔진: resolveErrorDecision  ← 단일 정책 해소자
  │  · 생성·검증: createDecisionSystem(catalog) · fail/appError · validateDetails · validateCatalog
  │  · 정규화·재수화: normalizeToDomainError · fromSerialized · fromClientSerialized
  │  · 누출 게이트: toClientSerialized · 단일 details allowlist · disclosure 강제
  │  · i18n: resolveErrorMessage (Translator seam · {token} 보간 · key-echo 거부 · never-throws)
  │  · 텔레메트리: ReporterSink/NotifierSink/Presenter · executeErrorDecision · sampling · dead-man's-switch
  │  · 재시도: computeRetryDelay · exponentialBackoffWithJitter · parseRetryAfter (순수)
  │  · 네트워크 경계: networkBoundary (8 transport codes) · toErrorResponse
  │  · 제네릭 경계 래퍼: defineFormAction/Query/ServerAction/BackgroundTask/RouteGuard
  │  ✘ 제거: AsyncLocalStorage · runWithErrorRegistry · setActiveErrorRegistry · 격리 가드
  │
  ├── error-react   (peer: react)
  │      · ErrorSurface (RSC-safe surface 렌더러 + slots)
  │      · hooks: DecisionSystemProvider/useDecisionSystem/useErrorDecision/useDecisionRedirect/useFormAction/useDecisionQuery
  │      · 제네릭 ErrorBoundary (신규 — 신 시스템에 없던 것)
  │
  ├── error-adapters (peer: @sentry/nextjs, sonner)
  │      · createSentryReporter + sentryBeforeSend (fingerprint · PII scrubDeep · storm throttle)
  │      · createSonnerPresenter (dedupe by code · Retry-After countdown)
  │      · createPagerNotifier + webhookPagerTransport (server-only · dedup 윈도우 · 교체 가능 transport)
  │      → 모두 커널의 ReporterSink/Presenter/NotifierSink 구현
  │
  └── error-next    (peer: next, @tanstack/react-query, react)  — Next 전용 경계만
         · safeServerAction/safeFormAction (useActionState shape · 코어 generic 래퍼를 감쌈)
         · enactDecision (server-only — surface→Next 인터럽트, §6)
         · framework control-flow 보존 (unstable_rethrow of redirect/notFound/forbidden)
         · per-request 컴포지션 루트 (getRequestHandler · React cache · getRequestCorrelationId)
         · ErrorFallback (error.tsx/global-error.tsx · AppRouterContext · unstable_retry · a11y)
         · makeQueryClient / shouldRetryQuery
         · ErrorHandlerInit (클라 싱글턴 부트스트랩)

apps/error-architecture  (Next 레퍼런스 — 풀스택: 커널+react+next+벤더 전부 도그푸딩)
apps/error-decision-vite (SPA 레퍼런스 — 무관 코어 + error-react 만으로 동작 증명)

✘ 은퇴: error-decision-system 패키지(코어로 흡수) · apps/error-decision-next · 브랜치 eds-production-hardening(중복)
```

### 4.1 두 레지스트리는 분리 유지 (중요)

`NEW.md`/`ERROR_DECISION_SYSTEM.md`는 Error Registry와 Operation Registry가 **"분리되어야 한다"**고 강조한다. 하나의 `createDecisionSystem`으로 받되 **별개 타입·별개 책임**을 유지한다.

```ts
createDecisionSystem({
  errors: ErrorCatalog,        // 실패의 본질: code → ErrorSemantics
  operations: OperationCatalog, // 제품 작업의 중요도: operation → OperationMeta (owner/criticality/defaultUiScope/piiRisk)
  fallbackErrorCode,
  validationErrorCode,
  sampler?,        // 기본 Math.random — 테스트 주입 가능
})
```

`OperationMeta.piiRisk`는 보존한다(§8 PII 불변식이 이를 사용).

## 5. 통합 데이터 모델

### 5.1 DomainError

순수 데이터로 통합한다. 앰비언트 레지스트리를 읽는 정책 getter를 제거한다(정책은 `resolveErrorDecision(error, occurrence, catalog)`가 온디맨드로 해소).

```ts
class DomainError<C extends string = string> extends Error {
  code: C;
  details?: DetailsOf<Catalog, C>; // per-code 타입
  cause?: unknown;
  occurrence?: Partial<OccurrenceContext>; // thrown 경로의 resource/event 컨텍스트 보존 (REVIEW.md 요구)
  correlationId?: string;
  retryAfterMs?: number;
  digest?: string;                 // RSC 경계용 (구 error-core에서 보존)
}
```

- 구 `error-core`의 per-instance 정책 getter(`severity`/`present`/`log`...)는 제거.
- 구/신 두 `DomainError`(app-error.ts vs decision-system index.ts)의 합집합 shape로 통합.

### 5.2 카탈로그 = ErrorSemantics + OperationMeta (정적)

`ErrorSemantics`가 정책 힌트를 갖되 **경계를 명문화**한다.

| 가져도 됨 (semantics 데이터) | 가지면 안 됨 (occurrence/presenter가 결정) |
|---|---|
| category, sensitivity | 최종 log level |
| defaultHttpStatus, defaultRetryable | alert flag |
| messageKeys (per disclosure) | 특정 React 컴포넌트 |
| detailsExposure / detailsAllowlist | 스크린별 field mapping |
| context별 disclosure/action/surface **힌트** | 특정 toast 카피 |
| redirectTarget (제한적) | — |

구 `ErrorMeta`의 평면 필드 매핑:
- `kind` → `category`, `httpStatus` → `defaultHttpStatus`, `retryable` → `defaultRetryable`, `userMessageKey` → `defaultMessageKey`/`messageKeys`.
- `present`/`log`/`severity`는 **힌트로 강등** — 더 이상 코드별로 *작성*하지 않고 엔진이 *도출*. 이를 "최종 결정"으로 읽던 소비자는 Phase에서 제거한다(§9 P2/P5).

### 5.3 통합 wire 페이로드 (잠금)

현재 두 패키지가 서로 다른 와이어 모양을 쓴다.

- 구 `error-core` `ClientSerializedError` = `{ code, userMessageKey, correlationId?, digest?, details? }`
- 신 `ClientErrorPayload` = `{ code, messageKey, disclosure, action?, supportCode?, retryAfterMs?, details? }`

**통합 모양:**

```ts
interface ClientErrorPayload {
  code: string;
  messageKey: string;        // 'userMessageKey'에서 명칭 통일
  messageVars?: TranslateVars; // §5.4 — 보간 복원
  disclosure: DisclosureLevel;
  action: UserAction;        // 와이어를 건넌다 (아래 결정)
  supportCode?: string;
  retryAfterMs?: number;
  correlationId?: string;    // 구 error-core 보존
  digest?: string;           // RSC 경계용 보존
  details?: unknown;         // 단일 allowlist 통과분만
}
```

잠근 결정:
- **`surface`/`target`은 와이어를 건너지 않는다** — 클라이언트가 재결정 (양쪽 구현 모두 이미 이렇게 함; 웹 전용이므로 시임 불필요).
- **`action`은 건넌다** — EDS 구현이 이미 보냄. `NEW.md` 타입 블록은 `action`을 누락했지만 산문(:901)은 보내라고 함 → 산문 쪽으로 일관화.
- **allowlist 메커니즘 1개로 통일**: 구 per-code `DETAILS_ALLOWLIST`(serialize-client.ts)와 신 `semantics.detailsExposure/detailsAllowlist`(index.ts) 중 하나로. 권고: `ErrorSemantics`에 co-located한 `detailsAllowlist`로 통일(카탈로그가 단일 진실).

### 5.4 i18n — messageVars 보간 복원 (i18n 손실 수정)

현재 신 시스템은 `RATE_LIMITED`의 `{seconds}` 카운트다운을 렌더하지 못한다 (`UserErrorDecision`/`ClientErrorPayload`에 vars 자리 없음, `translate(messageKey)`가 vars를 못 받음). 구 `error-core`는 이를 렌더하고 테스트로 보증한다(`i18n-completeness.test.ts:142`).

수정:
- `UserErrorDecision` + `ClientErrorPayload`에 `messageVars?: TranslateVars` 추가 (또는 `retryAfterMs`에서 파생).
- `error-react`의 `ErrorSurface`/`ErrorBoundary`는 EDS의 trivial `translate` 대신 **`error-core.resolveErrorMessage(decision.user.messageKey, translator, messageVars)`**를 호출.
- EDS `demo.ts`의 `messages`/`translate`는 **레퍼런스 앱 예시로만** 남기고 커널 코드에서는 폐기.

### 5.5 disclosure 구조적 강제 + validateCatalog

신 시스템의 init-time 검증을 보존한다.

- `resolveMessageKey = semantics.messageKeys?.[disclosure] ?? defaultMessageKey` — disclosure가 메시지 선택을 **구조적으로 강제**.
- `validateCatalog`: 도달 가능한 disclosure 레벨마다 안전한 messageKey가 없으면 / `fallbackErrorCode` 부재 시 **생성 시점에 throw**. `validateMessageKeys: false` opt-out 유지.

**Known Limitation (잠금):** 구 `FALLBACK_MESSAGES`는 15개 canonical 코드에만 키가 있다. EDS가 만든 per-disclosure 키(`*.safe`/`*.generic`/`*.support`)는 co-located fallback이 없어, **host Translator가 없으면 generic 라인으로 degrade**한다. `validateCatalog`는 *키 존재*만 보장하지 *dependency-free 경로의 해소*는 보장하지 않는다. → 정적 카탈로그가 messageKey별 inline fallback 카피를 들지(SPA가 disclosure nuance 유지) 아니면 "Translator 없으면 generic" 동작을 문서화할지 P4에서 결정. 기본 권고: 카탈로그에 inline fallback 카피 보유.

## 6. 결정 해소 & 경계 enactment (잠금)

`resolveErrorDecision`이 page-vs-component의 **단일 권위**다. 현재 `error-next`의 `raise()`는 `error.code`만 보고 분기(`NOT_FOUND→notFound`, `AUTH_REQUIRED→redirect`, `FORBIDDEN→forbidden`)하고, EDS `defineQuery`/`useDecisionQuery`는 같은 throw를 in-component `DecisionResult`로 바꾼다 — `resolveSurface`가 `page`/`redirect`를 내도 인터럽트하지 않는다. 이 충돌을 해소한다.

규칙:
1. `raise()`의 하드코딩 `error.code` switch **삭제**. page-ness는 occurrence가 결정.
2. **`enactDecision(decision)`** (server-only, `error-next`) 도입:
   - `uiScope: 'page'` (route/render boundary) + `surface: 'page'/'redirect'` → **실제 Next 인터럽트** (`notFound()`/`forbidden()`/`redirect(target)`/일반 page는 `throw → error.tsx`).
   - `uiScope: 'component'` (query/component boundary) → `surface: 'inline'/'toast'/'dialog'`를 **`DecisionResult`로 반환**해 `ErrorSurface` 렌더 (현재 `defineQuery`/`useDecisionQuery` 동작 유지).
3. 판별자 = boundary 래퍼가 채우는 `occurrence.uiScope`/`interaction` (`withRenderBoundary`/`defineRouteGuard`→`page`, `defineQuery`→`component`). → "throw is not always page"가 occurrence로 **기계검증**됨.
4. precedence 보존: `call-site override > boundary defaults > operation registry default` (Codex가 잡은 버그, EDS.md:993). `finalizeFailure`의 fieldPath/uiScope 병합 수정도 보존.

## 7. DX 레이어 & 진입점 (잠금)

- **80/15/5**: 80% = `fail(code)`/`throw appError(code)`; 15% = 제한 override(`retryAfterMs`/`userCanRetry`); 5% = 전체 occurrence/telemetry escape hatch (드물게, 리뷰 대상). FailureOptions 사용 컨벤션이지 라벨 기능이 아님.
- **free `fail`/`appError`(느슨) vs catalog-typed `decisionSystem.fail`/`appError`(per-code details 강제)** 분리 유지.
- **Next 앱 80% 진입점 = `error-next`의 `safe*`가 코어 generic `define*`를 감싸는 형태.** 코어 제네릭 위에 Next `useActionState`/control-flow/per-request root를 더한다. 앱 개발자는 Next 앱에서 `error-next` 래퍼를, SPA에서 코어 generic 래퍼를 쓴다 → 단일 멘탈모델(operation + code + Result-vs-throw) 유지.

## 8. 가드레일 레이어 (풀 + CI)

문서가 일급으로 요구하나 **현재 enforcement로는 전무**하다(`.eslintrc*`/`eslint.config.*` 0개, 패키지별 lint 스크립트 없어 `turbo run lint`는 no-op, CI 없음).

구축:
1. **ESLint flat-config** (워크스페이스 루트):
   - `no-restricted-imports`: feature/app 코드에서 `@sentry/*`, `sonner`, pager client 직접 import **금지** (어댑터/컴포지션 루트만 허용).
   - `no-restricted-syntax`: `toast(error.message)`, `error.message` 직접 렌더, `Sentry.captureException` 직접 호출 **금지**.
2. **패키지별 lint 스크립트** → `turbo run lint` 실효화.
3. **CI 게이트** (`.github/workflows`) + **PR 체크리스트**.
4. **불변식 enforcement를 error-core로 이전** (은퇴 패키지에서 증발 방지): `validateCatalog` disclosure/messageKey 불변식, 시나리오 매트릭스 테이블 테스트, i18n key-echo 거부, registry invariants, precedence, `finalizeFailure` fieldPath.
5. **PII 불변식**: `message`/`details`/`fingerprint`/`tags`에 PII 금지 검사 + `OperationMeta.piiRisk` 활용. (Sentry `sentryBeforeSend` 스크럽은 sink 하나만 커버하므로 커널 산출 단계에서 추가 보장.)

## 9. 마이그레이션 (6+Phase staged, 각 단계 green 유지)

clean break가 가능하지만, 회귀 방지 + 리뷰 가능성을 위해 단계적으로 간다. 각 Phase는 독립 PR이며 직전까지의 테스트를 green으로 유지한다.

| Phase | 내용 | 비고 |
|---|---|---|
| **P0 정리·baseline** | 중복 브랜치 `eds-production-hardening` 삭제. 전체 테스트(구 ~187 + 신 ~43) green 고정. 양 시스템 공개 API 표면 인벤토리. | 동작 변경 없음 |
| **P1 vocabulary** | `ErrorSemantics`/`OperationMeta`/`OccurrenceContext`/`RuntimeContext` + 결정 union들을 `error-core`에 추가 (기존 `ErrorMeta`와 병존). | 해소자 없음 |
| **P2 엔진 graft** | `resolveErrorDecision`(+telemetry)를 `error-core`로 이식. 기존 15코드 registry에서 `ErrorSemantics`를 파생하는 shim. `validateCatalog` 추가. flat 필드 → 힌트 강등. | 두 해소자 일시 병존 |
| **P3 DomainError 통합 + ALS 제거 (keystone)** | `DomainError`를 순수 데이터로 재작성, `AsyncLocalStorage`/`runWithErrorRegistry`/격리 가드 제거. 카탈로그를 `createDecisionSystem`로 명시 주입. **통합 wire 페이로드 + allowlist 통일 + messageVars** 적용. normalization/rehydration/serialization을 통합 모델로. | 커널 정체성 변경 — 최고 위험. 커널 전체 테스트 게이팅 |
| **P4 error-react 추출** | `error-react` 신설, `ErrorSurface`+hooks 이주, 제네릭 `ErrorBoundary` 추가. `resolveErrorMessage` 배선(EDS trivial translate 폐기). 카탈로그 inline fallback 카피 결정 반영. | |
| **P5 error-next 슬림화** | `safeServerAction`/`safeFormAction`/per-request root/`ErrorFallback`/QueryClient를 통합 커널 + `error-react` 위에 재구성. `raise()` → `enactDecision`. control-flow 보존 유지. **미테스트 seam에 테스트 추가**(safeServerAction/raise/request-handler.server/useErrorHandler/withRetry/next-control-flow/ErrorHandlerInit). | error-next가 최저 커버리지 — 테스트 *추가* 필수 |
| **P6 벤더 재배선** | Sentry/sonner/pager를 통합 커널 sink 인터페이스로 재연결(주로 기계적). pager dedupKey는 adapter-side 유지. | |
| **P7 가드레일 + CI** | ESLint flat-config + no-restricted-imports/syntax + 패키지 lint 스크립트 + CI + PR 체크리스트 구축. enforcement 이전 완료(§8). | |
| **P8 데모/문서 수렴** | `error-decision-system` 패키지 + `apps/error-decision-next` 은퇴. `apps/error-architecture`를 통합 스택(신 hooks/ErrorSurface 포함) 도그푸딩으로 마이그레이션. `apps/error-decision-vite`는 SPA/무관 코어 증명으로 유지. `README`/설계 문서 단일화(`NEW.md`/`ERROR_DECISION_SYSTEM.md`/`error-design-kr.md`를 단일 canonical 문서로 통합, 나머지는 historical 마킹). | |

## 10. 테스트 & 검증 전략

- 구 ~187 테스트 보존 — 각 Phase가 직전 Phase의 테스트를 green 유지(또는 의도적 동작 변경을 문서화하며 마이그레이션).
- **신규 커버리지 필수**: `error-next`의 load-bearing seam(safeServerAction/raise/request-handler.server/useErrorHandler/withRetry/next-control-flow/ErrorHandlerInit)은 현재 전용 테스트가 없음 → P5에서 **추가**(상속하지 말 것).
- **시나리오 매트릭스**: `ERROR_DECISION_SYSTEM.md`의 결정 매트릭스를 고정하는 테이블 테스트를 통합 커널의 새 홈으로 이전. (현재 `toMatchObject` 테이블 — true snapshot 아님. 테이블 형태 유지하되 새 홈으로 이동.)
- **불변식 테스트**: `validateCatalog` throw, details allowlist 누출, per-code details `@ts-expect-error`, precedence, finalizeFailure.
- **레퍼런스 앱 통합 증명**: `error-architecture`(Next 풀스택 + 벤더 + 경계) + `error-decision-vite`(SPA) 둘 다 build + run green.
- **DX scorecard 재측정**(`NEW_DX.md`): 기본 form action ~10줄, 새 개발자 30분 내 첫 action, override는 드물게 — 4-패키지 토폴로지에 대해 재검증(import 표면/generic-vs-next 중복이 게이트를 퇴보시키지 않는지).

## 11. Known Limitations (잠금)

- **SEC-4 nested allowlist 미강제**: top-level allowlist는 strip하지만 중첩 객체의 excess property는 컴파일 excess-property 검사를 통과할 수 있음. P3 직렬화 작업에서 `pickAllowlistedDetails`를 재귀화하거나 Known Limitation으로 명시. SPA(error-decision-vite)가 두 번째 무관 소비자이므로 표면이 넓어짐.
- **dependency-free fallback degrade**: host Translator 부재 시 per-disclosure 키가 generic 라인으로 degrade (§5.5).
- **alert dedup은 adapter-side**: 엔진은 `alert: boolean` + `fingerprint`만 결정. pager `NotifierSink`가 `DomainError`+ctx에서 `code:route` dedupKey를 재파생(현재 pager-notifier.ts:37 동작). doc open Q6("초기 boolean, 이후 reason/dedupKey")는 미해결 — 구조화는 후속.
- **rate/frequency 기반 알림 상태**: 정적 카탈로그 커널은 무상태. frequency-elevated/recent-deploy 입력은 adapter 레이어(Sentry storm throttle, pager dedup)에 둠.
- **correlationId 생성**: `error-next`는 per-request `getRequestCorrelationId`. 커널/SPA 경로는 클라 init에서 `crypto.randomUUID` 시임으로 생성/전파.

## 12. 미해결 / 후속 RFC 후보

- alert를 `{ alert, reason?, dedupKey? }` 구조로 승격할지 (doc open Q6).
- thrown 경로(`query`/`route guard`)의 free `fail`/`appError` code 협소화 (현재 `<C extends string>` 느슨) — 추가 API 설계 필요.
- SEC-4 nested allowlist 완전 해소.

---

## 부록 A. 결정된 합의 요약

| # | 질문 | 결정 |
|---|---|---|
| 1 | 프로덕션 소비자 | 없음 — 설계 레퍼런스 레포 (clean break) |
| 2 | 레지스트리 모델 | A: 정적 카탈로그 (ALS 제거) |
| 3 | 프레임워크 타겟 | 무관 코어 + Next 어댑터 + 제네릭 React |
| 4 | 수렴 접근법 | Approach 1: 제자리 진화 |
| 5 | Multi-platform | 웹 전용 — YAGNI |
| 6 | 가드레일 범위 | 풀 가드레일 + CI |
| 7 | 이행 방식 | 단계적 6+Phase staged |
