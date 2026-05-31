# Next.js(App Router) + TypeScript를 위한 통합 에러 시스템

> 프로젝트 비종속적 설계. 원본 시리즈 고유의 어휘 — `ERROR_REGISTRY`, `DomainError`/`makeError`, 투 트랙(two-track) `Result` 전략, 단일 `handleError`/`handleServerError` 처리기, Reporter/Presenter 주입(DI), 그리고 여섯 개의 경계(boundaries) — 를 존중하며, 이를 Next.js v16.2.x App Router 메커니즘과 재조정한다. 시리즈와 프레임워크가 충돌하는 지점에서는 이를 표시하고 한쪽 편을 택한다.
>
> **개정 r2.** (1) GA/Amplitude `Analytics` 싱크를 제거했다 — 제품 분석은 에러 파이프라인의 **범위 밖**이다(이는 기능 계층에서 방출되는 별개의 관심사이며, 결코 `handleError`를 통하지 않는다). 시리즈의 두 싱크로 되돌렸다: `Reporter`(모니터링) + `Presenter`(UX). correlation ID와 사용자 컨텍스트는 유지되며 `Reporter`(Sentry) + 서버 로그에 안착한다. (2) 쿼리 처리를 팀 아키텍처 문서(`§15.1` / `AGENTS.md`)와 재조정했다: **전달은 라이브러리가 아니라 연산에 따라 분리된다 — 뮤테이션은 `Result`(투 트랙)를 반환하고, 쿼리는 `DomainError`(단일 트랙)를 던진다.**
>
> **개정 r3 — 빈틈을 배선했으며, 잘라낸 것은 없다.** r2는 설계상 완결되었으나 컴파일 에러와 미정의 심볼 빈틈이 있었다. r3는 이들을 하나도 빠짐없이 메우고, r2가 선언만 해두었던 기능들을 *완전히 배선한다*. **잘라낸 기능은 없으며, 빈틈을 배선했다.** 변경 이력:
> 1. **컴파일 수정 — 맨몸의 `ERROR_REGISTRY`(TS2304).** 단일 런타임 권위인 *활성 레지스트리*(`error/active-registry.ts`)를 도입했다: 클라이언트 싱글톤(`setActiveErrorRegistry`) + 서버 요청별 `AsyncLocalStorage`(`runWithErrorRegistry`). `DomainError` 게터, `isSerializedError`, 그리고 `handleError`의 공유 `resolvePolicy()`가 모두 이를 읽으므로, 인스턴스와 핸들러는 결코 어긋날 수 없다. `registry.ts`는 의존성 없는 SSOT(단일 진실 공급원) 리프로 남아 `DEFAULT_ERROR_REGISTRY`만 내보낸다. `handleError`는 이제 `ResolvedAppError`를 반환한다(§3/§5).
> 2. **직렬화 재수화(rehydration)(결정적 사례).** 이전에 누락되어 있던 1단계 정규화기 `normalizeToDomainError` + `DomainError.fromSerialized`를 정의하여, RSC/네트워크 경계를 *평범한 객체*로 넘어온 서버 발생 에러가 `UNKNOWN_CLIENT_ERROR`로 오분류되는 대신 일급 인스턴스로 재구성되도록 했다(§3/§4.3/§5). `toSerialized()`가 `digest`를 왕복 처리하도록 수정했으며, `construct()` 내의 단 하나의 `details` 캐스트를 국소화했다.
> 3. **`networkBoundary<T>` — 완전히 정의됨.** r2가 참조했으나 결코 작성하지 않았던, 던지는 쿼리 트랙 진입점이다. 서버 신뢰 코드 보존이 첫째, 상태 클래스 폴백이 둘째다; 결정론적 TIMEOUT 대 REQUEST_ABORTED 판별; `x-request-id`로부터의 correlation ID 추출(§8.5).
> 4. **React `cache()`를 통한 요청별 서버 핸들러.** `getRequestHandler()` / `getRequestCorrelationId()` / `serverDeps`(§7.1a)를 동시 요청 격리 테스트와 함께 정의했다 — 요청 간 correlationId/사용자 누출 없음. §7.1 호출 지점의 누락된 `await`를 수정했다.
> 5. **`safeFormAction` — `useActionState` 합성.** RPC 스타일 `safeServerAction`과 나란히 형제 격인 폼 뮤테이션 경계를 추가했다; 깨져 있던 §8.4 로그인 예제를 다시 작성하여 액션 시그니처 `(prevState, formData)`가 실제로 합성되도록 했다(§7.1a).
> 6. **`retryable`를 하중 지지로 만듦 + `RATE_LIMITED`(429) + `Retry-After`.** 공유 `QueryClient` 재시도 술어(`NOT_FOUND`는 이제 0회 재시도하여 기본 `retry:3`을 바로잡음), 서버 `Retry-After`를 우선하는 단일 지연 오라클, 그리고 서버 `withRetry`(§8.6).
> 7. **severity → 알림(세 번째 싱크, `Notifier`).** `Notifier` + `AlertPolicy` + 교체 가능한 페이저 어댑터를 추가하여, `report()` 이후 `createHandleError`에 배선했다(§5).
> 8. **`page` PresentAction가 실제 메커니즘을 갖게 됨.** `Presenter`는 `page`를 no-op으로 취급한다; `useErrorHandler`는 정규화된 에러를 가장 가까운 `error.tsx`로 다시 던져 에스컬레이션하며, 선택적 전용 라우트 맵(예: `FORBIDDEN → /403`)을 둔다(§8.2).
> 9. **`userMessageKey`에 대한 i18n.** 라이브러리 비종속적 `Translator`, 레지스트리에 함께 위치한 `FALLBACK_MESSAGES` 맵(키 누락이 출하될 수 없도록 타이핑됨), 결코 던지지 않는 리졸버, `global-error.tsx`를 위한 프로바이더 없는 폴백, 그리고 CI 완전성 테스트(§6.3).
> 10. **누출 방지 강제 지점으로서의 직렬화기 + Sentry 강화.** `toClientSerialized()`는 자유 텍스트 `message`를 떨궈내고 코드별 허용 목록으로 `details`를 게이팅한다; Sentry 어댑터는 `beforeSend` PII 스크럽, `fingerprint`, 브라우저 폭주 토큰 버킷, 그리고 dead-man-switch(데드맨 스위치) 복합체를 얻는다(§5/§7.4).
> 11. **Next 16 `proxy.ts` 프레이밍 + correlation 정합성.** `middleware.ts` → `proxy.ts`(이름 붙은 `proxy` export, Node.js 런타임); 모든 "edge" 어휘를 떨궈냈다; `TelemetryContext.runtime`을 `"server" | "client"`로 좁혔다(§2/§9).
>
> **개정 r4 — 구체화 및 검증됨; 문서를 컴파일되는 코드에 재조정함.** 이 설계는 독립 프로젝트(`/tmp/error-core`, 소스 파일 41개)로 구현되어 검증되었다: 실제 라이브러리(next@15.5, react@19, zod@3.25, @sentry/nextjs@8, @tanstack/react-query@5)를 상대로 `strict` + `noUncheckedIndexedAccess` 하에서 `tsc --noEmit`이 0으로 종료하며, §10 스위트가 녹색으로 통과한다(vitest: 파일 12개 / 테스트 239개, 실패 0). 위의 코드 블록들은 그 구현과 재조정되어 있다; **`/tmp/error-core/src`가 정본 컴파일 소스다** — 예시 스니펫과 구현이 어긋나는 경우 언제든 구현이 이긴다(§12 참조).
>
> **개정 r5 — kind enum, present(+inline/silent), impact(impact) breadcrumb(브레드크럼), 프로덕션 빈틈 수정; 구체화 및 재검증됨(tsc 0, vitest 324/0, 소스 파일 47개). expected:boolean -> kind; ux -> present; Reporter.breadcrumb 추가; DETAILS_ALLOWLIST를 스키마에 대해 타이핑; 실제 Sonner presenter; 배럴; /api/health; networkBoundary 아웃바운드 correlationId; ErrorFallback retry/focus/a11y. /tmp/error-core/src가 정본 컴파일 소스로 남는다.**
>
> **개정 r6 — 모노레포 분리(Turborepo + pnpm).** 단일 `src/core/error/` 트리를 의존성 방향에 따라 세 개의 워크스페이스 패키지로 분리하고, 이를 소비하는 Next.js 16 레퍼런스 앱을 추가했다: **`error-core`**(zod만 의존하는 isomorphic 커널 — 어휘 리프·레지스트리·모델·텔레메트리 계약·`createHandleError`·정규화·직렬화 누출 게이트·순수 재시도·`networkBoundary`·클라이언트 싱글턴 sink·순수 console/composite 어댑터), **`error-adapters`**(벤더 격리 — Sentry·sonner·pager; 벤더 SDK는 optional peerDependency), **`error-next`**(Next/React 통합 — 경계·요청별 컴포지션 루트·`useErrorHandler`·QueryClient·에러 바운더리 컴포넌트; 클라이언트 표면 `error-next`, 서버 전용 표면 `error-next/server`). 패키지는 빌드 단계 없이 `.ts` 소스를 그대로 `exports`로 내보내며(raw-TS 내부 패키지), 앱이 `transpilePackages`로 트랜스파일한다. **설계 자체는 변하지 않았다 — 8계층 단방향 의존성과 "벤더를 아는 파일은 하나"라는 DI 격리 원칙을 *물리적 패키지 경계*로 만든 것이다.** 검증 보존: 커널/어댑터/통합은 검증된 baseline(zod3·@sentry8·sonner1·TanStack5·vitest2·next15.1.4 dev)을 유지해 324개 테스트(core 277·adapters 11·next 36)가 그대로 통과하고, **앱만** Next 16.2 + React 19.2로 `next build`(Turbopack)된다. 정본 소스는 이제 `packages/{error-core,error-adapters,error-next}/src` + `apps/error-architecture`다. 모노레포 상세는 §12.6.

---
## 1. 설계 목표 및 원칙

**목표**

1. **하나의 처리 경로, 여러 전달 트랙.** 모든 에러 — 서버, 네트워크, 렌더, 이벤트 핸들러, 처리되지 않은 거부(unhandled rejection) — 는 단일 `handleError`(클라이언트) / `handleServerError`(서버)로 수렴한다. 전달은 분기하지만(Return vs Throw), *처리는 분기하지 않는다*. 이는 이 시리즈의 핵심 약속이며, 나는 이를 그대로 유지한다.
2. **정책은 데이터, 메커니즘은 코드.** `ERROR_REGISTRY`는 코드별 정책(`kind`, `present`, `log`, 그리고 아래의 추가 항목들)을 보유한다. `handleError`만이 이를 읽는 유일한 주체다. 어떤 코드의 동작을 바꾸는 것 = 레지스트리의 한 행을 편집하는 것. `kind`는 세 가지 분류(`"business" | "operational" | "fault"`)이며, `present`는 사용자 대면 전달을 명명한다(`"toast" | "alert" | "inline" | "silent"`).
3. **모든 것은 주입(DI)되며, 기능 코드에는 어떤 것도 하드와이어되지 않는다.** 어떤 기능 파일도 `@sentry/*`를 import하지 않는다. 벤더 SDK는 컴포지션 루트에서 한 번 배선되는 어댑터 내부에만 존재한다. 레지스트리 자체도 마찬가지다 — 주입되므로, 호스트 앱이나 테스트가 자신만의 카탈로그로 대체할 수 있다.
4. **구성에 의한 직렬화 안전.** RSC/네트워크 경계를 넘어가는 것은 평범한 `SerializedError` JSON 객체뿐이다. 클래스 인스턴스는 결코 이동하지 않는다. *(r3: 직렬화기는 이제 누출 방지 강제 지점이기도 하다 — §5 `toClientSerialized` 참조.)*
5. **HTTP 시맨틱은 일급(first-class)이다.** 401/403/404는 Next의 전용 제어 흐름(프레임워크 인터럽트)을 사용하고, 500은 throw된 예외 경로다. 레지스트리는 코드 → 상태를 매핑하여 서버 경계와 Route Handler가 일관성을 유지하도록 한다.
6. **관측 가능성은 상관(correlate)된다.** correlation ID는 **프록시 경계(Node 런타임)**에서 생성되어 서버→클라이언트로 전파되고, 모든 Sentry 이벤트와 모든 서버 로그 라인에 부착된다.

**원칙(load-bearing 규칙, 시리즈 + Next 문서에서 이어짐)**

- *의도*(에러의 `kind` — `business` vs `operational` vs `fault`) **그리고** *위치*(어느 경계인지)에 따라 **코딩 전에 분류하라**. Error Boundary만으로는 불충분하다 — 이벤트 핸들러 에러와 비동기 에러는 그것을 빠져나간다.
- **전달은 라이브러리가 아니라 연산에 따라 분기된다: 뮤테이션은 `Result`를 반환하고(투 트랙), 쿼리는 `DomainError`를 throw한다(싱글 트랙).** §8.4 참조. 이는 시리즈(비즈니스 에러에 대한 Result)와 *TanStack Query가 `DomainError`를 throw한다*는 팀 아키텍처 문서의 규칙을 재조정한다.
- **뮤테이션*에서* 비즈니스 에러를 throw하지 말라**(Next 문서) — `useActionState` / 조건부 렌더를 통해 표면화되는 `Result`로 모델링하라. 반면 *쿼리*는 자신의 비즈니스 에러(예: `NOT_FOUND`)를 실제로 throw하며, 이를 React Query `error` 또는 `raise()`된 프레임워크 인터럽트를 통해 표면화한다. 순수한 `throw new Error`는 진짜 버그와 네 가지 프레임워크 인터럽트를 위해 남겨 두라.
- **fault는 한 번 캡처하고, 영향(impact)은 별도로 기록하라.** 서버/네트워크 경계에서 보고된 fault는 클라이언트에서 재보고되지 않는다 — `error.tsx`/`global-error.tsx`(및 쿼리 소비자)는 `log: "none"`으로 호출하므로, 최초 캡처가 단일 진실 공급원으로 유지된다. 그러나 "재보고하지 말라"는 더 이상 "침묵하라"와 혼동되지 않는다: `present !== "silent"`일 때마다 `handleError`는 동일한 `correlationId`로 키가 지정된 **영향(impact) breadcrumb**(`reporter.breadcrumb`)를 발행한다. fault는 정확히 한 번 캡처되고, 그 fault의 *사용자에게 보이는 영향(impact)*은 억제되는 대신 상관된 breadcrumb으로 기록된다 — 따라서 타임라인은 무엇이 깨졌는지와 사용자가 무엇을 보았는지를 모두 보여주며, 중복 fault 이벤트가 없다.
- **렌더 안전성.** `handleError`는 `present:"silent" && log:"none"`일 때만 렌더 중에 실행된다. 그렇지 않으면 `useEffect` 안에 위치한다.
- **RSC 에러에 대해 prod `error.message`를 결코 신뢰하지 말라** — 그것은 일반적인 플레이스홀더다. `digest`를 통해 서버 로그와 상관시켜라.
- **프레임워크 제어 흐름을 결코 삼키지 말라.** `redirect`/`notFound`/`forbidden`/`unauthorized` throw는 모든 경계에서 손대지 않고 그대로 다시 throw된다.
- **`handleError`는 순수하지 않다.** 그것은 조건부 부수 효과를 수행한다. 테스트에서 그렇게 다루어라.

---
## 2. 계층형 아키텍처 개요

```
COMPOSITION ROOT (per runtime)
  - ERROR_REGISTRY                 (주입됨; *활성* 레지스트리가 런타임 권위를 가짐)
  - Reporter  → Sentry / console   (모니터링; correlationId + 사용자 컨텍스트를 실어 나름; breadcrumb())
  - Presenter → sonner toast / 서버에서는 no-op
  - Notifier  → pager (서버, AlertPolicy로 게이팅됨) / noop (클라이언트)
  - Translator→ 호스트 i18n / 함께 배치된 폴백 (userMessageKey 해석)
  server : createHandleError(deps, ctx)   — React cache()를 통해 요청마다 (새 ctx, 요청 간 누수 없음)
  client : initHandleError(deps)           — 시작 시 한 번
        │ injects
        ▼
DELIVERY (split by operation)        PROCESSING (one sink)              SINKS (injected)
  Mutations  (Server Action/Command)     handleError(err, opts)             Reporter  → Sentry / console
    business   → Result(Failure) ─┐        1 normalize → AppError            Presenter → toast / alert
    fault/op   → throw ───────────┤        2 resolvePolicy (active reg)      Notifier  → pager (gated)
  Queries  (useQuery / RSC read)   ├──▶     3 report     (Reporter, log≠none)
    always throw DomainError ──────┘        4 notify     (Notifier, gated)
                                            5 present     (Presenter, toast/alert only)
                                            6 breadcrumb  (Reporter, present≠silent)
                                            7 return ResolvedAppError
                                                  ▲
                                  correlationId + 사용자 컨텍스트가 여기서 붙음

THE SIX 경계 (defensive lines, outer→inner):
  Browser(window.onerror / onunhandledrejection) ▷ Root(global-error.tsx) ▷ Render(error.tsx)
  ▷ Interaction(safeHandler) ▷ Network(networkBoundary) ▷ Server(safeServerAction)
    Server + Network            = 변환 (원본 raw → AppError로 변환)
    Interaction + Render + Browser = 처리 (Handle: present / log)

Correlation ID:  proxy.ts (Node runtime) mints x-request-id
  ─▶ forwarded INBOUND via NextResponse.next({ request: { headers } })  (RSC-readable via await headers())
  ─▶ echoed on response header + non-httpOnly cookie  ─▶ seeds client init
  ─▶ Reporter.setContext (Sentry tag) + server logs + SerializedError.correlationId
```

**패키지 매핑 (모노레포 r6).** 위 계층은 세 워크스페이스 패키지로 물리적으로 나뉜다(의존 방향: `error-core` ◄ `error-adapters` ◄ `error-next` ◄ 앱):

```
error-core      어휘 리프 · 레지스트리/모델 · 텔레메트리 계약 · 단일 처리 경로(createHandleError)
                · 정규화 · 직렬화 누출 게이트 · 순수 재시도(backoff/retry-after) · networkBoundary
                · 클라 싱글턴 sink(handler/safeHandler/browser-boundary) · 순수 어댑터(console/composite)
error-adapters  벤더 격리 — sentry-reporter · sonner-presenter · pager-notifier (optional peerDeps)
error-next      경계(safe*Action · raise · route-handler 재노출) · 요청별 컴포지션 루트
                · useErrorHandler · QueryClient · ErrorFallback/ErrorHandlerInit · registry-context
                클라 표면: error-next        서버 표면: error-next/server
```

> **표기 규약.** 이 문서의 코드 스니펫은 간결성을 위해 시리즈의 `@/error/*` 별칭을 유지한다. 모노레포에서 이는 다음으로 해소된다: core 모듈 → `error-core/*`, 통합 모듈 → `error-next`(클라)/`error-next/server`, 벤더 어댑터 → `error-adapters/*`. 단, 각 패키지 *내부* 파일은 상대 경로를 쓰고(예: `error-core/src/handle-error.ts`는 `./app-error`를 import), **테스트는 vitest alias로 `@/error/*`를 문자 그대로 유지**한다(따라서 §10 테스트 스니펫의 `@/error/*`는 여전히 정확하다).

---
## 3. 오류 분류 체계 — `AppError` 클래스 계층

이 시리즈는 `ErrorCode`를 키로 하는 단일 `DomainError<C>`를 사용한다. 전달에는 그것으로 충분하지만, 사용자의 하드 요구사항(심각도, 재시도 가능 여부, HTTP 상태 매핑, `userMessageKey`, `isOperational`)은 더 풍부한 기반을 요구한다. 나는 시리즈의 정본 이름인 `DomainError`를 유지하여 이를 구체 기반 클래스로 삼고, 가독성을 위해 `AppError`로 별칭을 둔다. 추가 필드는 **기본적으로 레지스트리에서 파생되며**(따라서 레지스트리가 SSOT(단일 진실 공급원)로 유지된다) 인스턴스별로 재정의할 수 있다.

```ts
// error/severity.ts
export type Severity = "fatal" | "error" | "warning" | "info";

// error/policy.ts — 정책 어휘 (시리즈에서 가져와 확장)
// r5: `UxAction` → `PresentAction`. 기존 `none`은 분할된다: 비즈니스 인라인 오류는
// `inline`(프레젠터 없이 필드/폼 옆에 렌더링)을 사용하고, REQUEST_ABORTED처럼 진정으로
// 조용한 것은 `silent`(프레젠터 없음, breadcrumb 없음)을 사용한다.
export type PresentAction = "inline" | "toast" | "alert" | "redirect" | "page" | "silent";
export type LogLevel = "fatal" | "error" | "warning" | "info" | "none";
export type HttpStatus = 400 | 401 | 403 | 404 | 408 | 409 | 422 | 429 | 500 | 502 | 503 | 504;

// 의도(Intent) 축 (r5). 불리언 `expected`를 대체한다:
//   business    — 의미 있는, 예상된 결과 (Track-1 / Result selector; 이전 expected:true)
//   operational — 환경적/일시적 실패 (여전히 "operational", 비결함)
//   fault       — 예상치 못한 결함 (이전 expected:false의 비-operational 부분집합)
export type ErrorKind = "business" | "operational" | "fault";
```

> **r3 — 단순한 모듈 글로벌 대신 단일 *활성 레지스트리*를 두는 이유.** r2의 컴파일 오류(TS2304: `ERROR_REGISTRY` undefined)는 오타가 아니었다 — 그것은 진짜 솔기(seam)를 드러냈다. 시리즈의 `DomainError` getter는 무인자 사용성(`err.httpStatus`)을 원하지만, §4.4는 레지스트리를 주입(DI) 가능하게(`deps.registry`) 만들었으므로, 대체된 카탈로그가 실제로 해소된 정책을 지배해야 한다. 단순한 모듈 수준 `ERROR_REGISTRY` const는 주입 가능하면서 *동시에* `deps`에 접근할 수 없는 getter에서 읽을 수 있는 두 가지를 모두 만족할 수 없다. 우리는 이를 단일 런타임 권위로 해소한다: 바로 **활성 레지스트리**다. `getActiveErrorRegistry()`는 컴포지션 루트에서 바인딩된 레지스트리가 무엇이든 그것을 반환한다 — 서버에서는 요청별 저장소(`AsyncLocalStorage`, Next 16.x가 RSC·Server Action·`proxy.ts`에 사용하는 Node.js 런타임에서 동시 요청 간 누출 없음)이고, 클라이언트에서는 `initHandleError`에서 한 번 바인딩된 모듈 싱글턴이다. 인스턴스 getter와 `isSerializedError` 양쪽 모두 이 하나의 함수를 읽으며, `handleError`는 자신이 주입받은 바로 그 레지스트리(`deps.registry`)를 해소하는데, 컴포지션 루트는 그것을 활성 레지스트리로도 바인딩한다. 따라서 인스턴스와 핸들러는 구조상 불일치할 수 없다 — 둘은 같은 객체를 읽고 있다.

### 3.1 `registry.ts` — SSOT 리프(leaf) (단순한 `ERROR_REGISTRY` 없음)

```ts
// error/registry.ts
// ============================================================================
// error/registry.ts  — SSOT 리프. 단순 ERROR_REGISTRY export 없음; DEFAULT만.
// ============================================================================
import type { Severity } from "./severity";
import type { ErrorKind, PresentAction, LogLevel, HttpStatus } from "./policy";

export interface ErrorMeta {
  /** 의도(Intent) 축 (r5 SSOT). business = Track-1/Result selector; 그 외에는 operational/fault. */
  readonly kind: ErrorKind;
  readonly severity: Severity; // 일급(first-class); 기본 로그 레벨 + Sentry 레벨을 결정
  readonly present: PresentAction; // 기준 사용자 가시 영향(user-visible-impact) 정책
  readonly log: LogLevel; // 기준 로그 정책
  readonly httpStatus: HttpStatus; // 401/403/404/500 구분
  readonly retryable: boolean; // 재시도가 의미 있는가?
  readonly userMessageKey: string; // 사용자 대면 메시지용 i18n 키
}

export const DEFAULT_ERROR_REGISTRY = {
  // ── business (mutations: Result로 반환 / queries: throw 후 error.code 분기) ──
  VALIDATION:           { kind: "business",    severity: "info",    present: "inline",   log: "none",    httpStatus: 422, retryable: false, userMessageKey: "error.validation" },
  INVALID_CREDENTIALS:  { kind: "business",    severity: "info",    present: "inline",   log: "info",    httpStatus: 401, retryable: false, userMessageKey: "error.invalidCredentials" },
  AUTH_REQUIRED:        { kind: "business",    severity: "info",    present: "redirect", log: "info",    httpStatus: 401, retryable: false, userMessageKey: "error.authRequired" },
  FORBIDDEN:            { kind: "business",    severity: "warning", present: "page",     log: "warning", httpStatus: 403, retryable: false, userMessageKey: "error.forbidden" },
  NOT_FOUND:            { kind: "business",    severity: "info",    present: "inline",   log: "none",    httpStatus: 404, retryable: false, userMessageKey: "error.notFound" },
  // ── operational (환경적/일시적; 비결함) ──
  OFFLINE:              { kind: "operational", severity: "warning", present: "toast",    log: "warning", httpStatus: 503, retryable: true,  userMessageKey: "error.offline" },
  TIMEOUT:              { kind: "operational", severity: "warning", present: "toast",    log: "warning", httpStatus: 504, retryable: true,  userMessageKey: "error.timeout" },
  REQUEST_ABORTED:      { kind: "operational", severity: "info",    present: "silent",   log: "info",    httpStatus: 503, retryable: false, userMessageKey: "error.aborted" },
  NETWORK_ERROR:        { kind: "operational", severity: "warning", present: "toast",    log: "warning", httpStatus: 502, retryable: true,  userMessageKey: "error.network" },
  HTTP_CLIENT_ERROR:    { kind: "operational", severity: "warning", present: "toast",    log: "warning", httpStatus: 400, retryable: false, userMessageKey: "error.httpClient" },
  RATE_LIMITED:         { kind: "operational", severity: "warning", present: "toast",    log: "warning", httpStatus: 429, retryable: true,  userMessageKey: "error.rateLimited" },
  // ── fault (예상치 못한 결함) ──
  HTTP_SERVER_ERROR:    { kind: "fault",       severity: "error",   present: "toast",    log: "error",   httpStatus: 500, retryable: true,  userMessageKey: "error.httpServer" },
  SCHEMA_MISMATCH:      { kind: "fault",       severity: "error",   present: "toast",    log: "error",   httpStatus: 502, retryable: false, userMessageKey: "error.schema" },
  UNKNOWN_SERVER_ERROR: { kind: "fault",       severity: "fatal",   present: "toast",    log: "error",   httpStatus: 500, retryable: false, userMessageKey: "error.unknown" },
  UNKNOWN_CLIENT_ERROR: { kind: "fault",       severity: "error",   present: "toast",    log: "error",   httpStatus: 500, retryable: false, userMessageKey: "error.unknown" },
} as const satisfies Record<string, ErrorMeta>;

/**
 * 주입 가능한 레지스트리. 대체된 카탈로그(호스트 확장 / 테스트 더블)는
 * `ErrorCode` 해소가 절대 누락되지 않도록 DEFAULT 키의 상위집합(superset)을 유지해야 한다;
 * 해소기(resolver)는 여전히 방어적으로 UNKNOWN_CLIENT_ERROR로 폴백한다.
 */
export type ErrorRegistry = Record<ErrorCode, ErrorMeta>;

/** 정본 코드들의 리터럴 유니언 — DEFAULT 레지스트리 키에서 파생 (SSOT). */
export type ErrorCode = keyof typeof DEFAULT_ERROR_REGISTRY;

// NOTE: `isExpectedCode`는 app-error.ts에 있다(활성 레지스트리를 읽으므로),
// registry.ts를 의존성 없는 SSOT 리프로 유지하고 active-registry.ts와의
// import 순환을 피한다. safeServerAction은 이를 "@/error/app-error"에서 import한다.
//
// NOTE: 단순한 `ERROR_REGISTRY` export는 의도적으로 없다. 단일
// 런타임 권위는 *활성* 레지스트리(active-registry.ts)다 — 즉
// DEFAULT_ERROR_REGISTRY이거나 컴포지션 루트에서 바인딩된 주입 deps.registry.
// 그 무엇도 모듈 수준의 가변 카탈로그를 직접 읽지 않는다.
```

> r3는 `FORBIDDEN`(시리즈의 인증 분할은 `INVALID_CREDENTIALS` 대 `AUTH_REQUIRED`였으나, 사용자는 403 구분을 요구한다)과 `RATE_LIMITED`(429 — *재시도해야 하는* 유일한 4xx; §8.6 참고)를 추가했다. `present:"page"`는 이제 §8.2에서 배선된 실제 에스컬레이션 동작이다. `ErrorRegistry`는 `Record<ErrorCode, ErrorMeta>`(이전에는 `Record<string, ErrorMeta>`)이므로, 대체된 레지스트리는 모든 정본 키를 담아야 한다 — 이것이 방어적 `?? UNKNOWN_CLIENT_ERROR` 폴백을 타입 안전하게 만든다.

> r5는 불리언 `expected` 축을 3분기 `kind: ErrorKind`(`"business" | "operational" | "fault"`)로 교체하고 UX 필드 `ux` → `present`(`PresentAction`)로 이름을 바꿨다. 이전의 `expected:true` 행은 이제 `kind:"business"`(Track-1 / Result selector)이고, 일시적 `expected:false` 행은 `kind:"operational"`이 되었으며, 진짜 결함은 `kind:"fault"`가 되었다. 이전의 `present:"none"`은 두 갈래로 분할된다: 비즈니스 인라인 오류(`VALIDATION`, `INVALID_CREDENTIALS`, `NOT_FOUND`)는 이제 `present:"inline"`을 가져 — 프레젠터 없이 필드/폼 옆에 렌더링되고 — `REQUEST_ABORTED`처럼 진정으로 조용한 흐름은 `present:"silent"`를 가진다(프레젠터도 영향(impact) breadcrumb(브레드크럼)도 없음). `isExpectedCode(code)`는 이제 `registry[code].kind === "business"`를 의미한다.

### 3.2 `active-registry.ts` — 바인딩 (양 경로가 읽는 단일 권위)

```ts
// error/active-registry.ts
// ============================================================================
// error/active-registry.ts  — 바인딩. 양 경로가 읽는 단일 권위.
// ============================================================================
import { DEFAULT_ERROR_REGISTRY, type ErrorRegistry } from "./registry";
import { getRuntime } from "./runtime";

// 서버 스코프. node:async_hooks가 절대 클라이언트 번들에 도달하지 않도록
// 타입화된 간접 참조를 통해 지연(lazy) import한다.
type AsyncLocalStorageLike<T> = {
  getStore(): T | undefined;
  run<R>(store: T, cb: () => R): R;
};

let _serverStore: AsyncLocalStorageLike<ErrorRegistry> | null = null;

const getServerStore = (): AsyncLocalStorageLike<ErrorRegistry> => {
  if (_serverStore) return _serverStore;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AsyncLocalStorage } = require("node:async_hooks") as typeof import("node:async_hooks");
  _serverStore = new AsyncLocalStorage<ErrorRegistry>();
  return _serverStore;
};

// 클라이언트 스코프 — 싱글턴(탭 하나 = 앱 하나 = 레지스트리 하나), init에서 바인딩됨.
let _clientRegistry: ErrorRegistry = DEFAULT_ERROR_REGISTRY;

// G3: 개발 전용 솔기(seam). `_substitutedRegistryExists`는 컴포지션 루트에서
// 비-DEFAULT 레지스트리가 처음 바인딩될 때(클라이언트 set 또는 서버 run) true로 뒤집힌다.
// 이후 getter가 활성 스토어가 바인딩되지 않은 채 레지스트리를 읽으면, 해소는
// 조용히 DEFAULT로 폴백한다 — 컴포지션 루트 배선 버그일 가능성이 높다. 한 번만(ONCE) 경고.
let _substitutedRegistryExists = false;
let _missingScopeWarned = false;

const isProd = (): boolean => process.env.NODE_ENV === "production";

const warnMissingScopeOnce = (): void => {
  if (isProd() || _missingScopeWarned || !_substitutedRegistryExists) return;
  _missingScopeWarned = true;
  // eslint-disable-next-line no-console
  console.warn(
    "[error] active registry read with NO scope bound, but a substituted registry " +
      "was registered at the composition root. Falling back to DEFAULT_ERROR_REGISTRY — " +
      "wrap server work in runWithErrorRegistry(deps.registry, …) (or call " +
      "setActiveErrorRegistry on the client) so the substituted catalog governs this read.",
  );
};

/**
 * 현재 실행에 적용 중인 레지스트리를 읽는다. 절대 undefined를 반환하지 않는다.
 * - 서버: runWithErrorRegistry 내부이면 요청별 스토어, 아니면 DEFAULT.
 * - 클라이언트: initHandleError에서 바인딩된 싱글턴, 아니면 DEFAULT.
 */
export const getActiveErrorRegistry = (): ErrorRegistry => {
  if (getRuntime() === "server") {
    const store = getServerStore().getStore();
    if (store === undefined) {
      warnMissingScopeOnce();
      return DEFAULT_ERROR_REGISTRY;
    }
    return store;
  }
  if (_clientRegistry === DEFAULT_ERROR_REGISTRY) warnMissingScopeOnce();
  return _clientRegistry;
};

/**
 * 클라이언트 컴포지션 루트 바인딩. initHandleError(deps) 내부에서 deps.registry로
 * 한 번 호출한다. 멱등(idempotent); 마지막 쓰기가 이긴다.
 */
export const setActiveErrorRegistry = (registry: ErrorRegistry): void => {
  if (registry !== DEFAULT_ERROR_REGISTRY) _substitutedRegistryExists = true; // G3
  if (getRuntime() !== "server") {
    _clientRegistry = registry;
    return;
  }
  // 서버에서 단순 set은 요청 간 누출되므로, 스코프화된 API를 강제한다.
  throw new Error(
    "setActiveErrorRegistry() is client-only. On the server, wrap the request " +
      "in runWithErrorRegistry(deps.registry, () => …) so the registry is scoped " +
      "per request (no cross-request leak).",
  );
};

/**
 * 서버 컴포지션 루트 바인딩. 요청별 작업(RSC 렌더, Server Action 본문,
 * Route Handler)을 이 안에서 실행하여 getActiveErrorRegistry()와
 * AppError getter들이 이 요청에 한해서만 deps.registry에 대해 해소되게 한다.
 */
export const runWithErrorRegistry = <R>(registry: ErrorRegistry, work: () => R): R => {
  if (registry !== DEFAULT_ERROR_REGISTRY) _substitutedRegistryExists = true; // G3
  return getServerStore().run(registry, work);
};
```

> r5는 **G3 개발 전용 1회 경고 솔기(warn-once seam)**를 추가했다. 어느 컴포지션 루트에서든 대체된(비-DEFAULT) 레지스트리가 바인딩되면 `_substitutedRegistryExists`가 뒤집힌다. 이후 getter가 스코프 바인딩 없이 활성 레지스트리를 읽으면 — 서버에서는 `runWithErrorRegistry` 밖일 때, 클라이언트에서는 싱글턴이 여전히 DEFAULT일 때 — 그 읽기는 조용히 `DEFAULT_ERROR_REGISTRY`로 폴백하는데, 이는 거의 항상 배선 버그다. `warnMissingScopeOnce()`는 정확히 하나의 `console.warn`을 방출하며(프로덕션에서는 절대, 한 번을 초과해서도 절대 아님), 누락된 `runWithErrorRegistry(deps.registry, …)` 래핑 또는 `setActiveErrorRegistry` 호출을 개발자에게 가리킨다. 두 바인딩 함수 모두 기반 저장소에 위임하기 전에 플래그를 설정하므로, 경고는 대체가 실제로 존재하게 된 이후에만 발생할 수 있다.
### 3.3 `app-error.ts` — getter는 활성 레지스트리를 읽는다; `resolvePolicy`; 재수화(rehydration)

```ts
// ============================================================================
// error/app-error.ts  — getter는 활성(ACTIVE) 레지스트리를 읽는다; resolvePolicy 공유.
// 클래스는 `digest`를 보유한다; toSerialized()가 그것을 방출한다; fromSerialized + construct().
// ============================================================================
import type { ErrorCode, ErrorMeta, ErrorRegistry } from "./registry";
import { DEFAULT_ERROR_REGISTRY } from "./registry";
import { getActiveErrorRegistry } from "./active-registry";
import { ErrorDetailsSchema, type ErrorDetailsMap } from "./schema";
import { getRuntime } from "./runtime";
import type { Severity } from "./severity";
import type { ErrorKind, PresentAction, LogLevel, HttpStatus } from "./policy";

/** RSC / 네트워크 경계를 넘는 일반 DTO. 결코 클래스 인스턴스가 아니다. */
export interface SerializedError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly details: unknown;
  readonly correlationId?: string;
  readonly digest?: string; // 가능할 때의 Next.js RSC digest
}

export interface AppErrorOptions<C extends ErrorCode> {
  code: C;
  details: ErrorDetailsMap[C];
  message?: string;
  cause?: unknown;
  severity?: Severity;
  retryable?: boolean;
  correlationId?: string;
  /** 이 에러가 직렬화된 페이로드로부터 재수화되었을 때의 Next.js RSC digest. */
  digest?: string;
}

/** 모든 해소된 정책 필드. handleError가 반환하는 단일 형태. */
export interface ResolvedPolicy {
  readonly expected: boolean;
  readonly isOperational: boolean;
  readonly severity: Severity;
  readonly present: PresentAction;
  readonly log: LogLevel;
  readonly httpStatus: HttpStatus;
  readonly retryable: boolean;
  readonly userMessageKey: string;
}

/**
 * 주어진 레지스트리에 대해 코드를 완전한 정책 번들로 해소한다. 일곱 개의
 * 필드가 모두 계산되는 단일 지점이다; 인스턴스별 오버라이드가 우선하며, 정확히
 * getter가 하는 방식과 같다. 대체된 레지스트리에 코드가 없을 때의 방어적 폴백.
 */
export const resolvePolicy = (
  registry: ErrorRegistry,
  code: ErrorCode,
  overrides?: { severity?: Severity; retryable?: boolean },
): ResolvedPolicy => {
  const meta: ErrorMeta = registry[code] ?? DEFAULT_ERROR_REGISTRY.UNKNOWN_CLIENT_ERROR;
  return {
    expected: meta.kind === "business",
    isOperational: meta.kind !== "fault",
    severity: overrides?.severity ?? meta.severity,
    present: meta.present,
    log: meta.log,
    httpStatus: meta.httpStatus,
    retryable: overrides?.retryable ?? meta.retryable,
    userMessageKey: meta.userMessageKey,
  };
};

/** handleError의 권위 있는 결과: 정규화된 에러 + 해소된 정책. */
export interface ResolvedAppError<C extends ErrorCode = ErrorCode> {
  readonly error: DomainError<C>;
  readonly code: C;
  readonly policy: ResolvedPolicy;
}

/**
 * 정본 내부 에러 (`AppError`는 문서화된 별칭이다). getter는 *활성(active)*
 * 레지스트리를 읽는다 — 결코 맨(bare) 모듈 전역이 아니다 — 따라서 인스턴스와
 * handleError 해소기(resolver)는 구성에 의해 일치한다. makeError()/
 * construct()/fromSerialized()를 통해 생성되므로 details가 검증된다.
 */
export class DomainError<C extends ErrorCode = ErrorCode> extends Error {
  readonly code: C;
  readonly details: ErrorDetailsMap[C];
  readonly correlationId?: string;
  readonly digest?: string; // 라운드트립되도록 저장된다
  private readonly severityOverride?: Severity;
  private readonly retryableOverride?: boolean;

  constructor(opts: AppErrorOptions<C>) {
    super(opts.message ?? opts.code, { cause: opts.cause });
    this.name = "DomainError";
    this.code = opts.code;
    this.details = opts.details;
    this.correlationId = opts.correlationId;
    this.digest = opts.digest;
    this.severityOverride = opts.severity;
    this.retryableOverride = opts.retryable;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** 활성 레지스트리에서 가져온, 이 인스턴스에 적용되는 ErrorMeta. */
  private get meta(): ErrorMeta {
    const registry = getActiveErrorRegistry();
    return registry[this.code] ?? DEFAULT_ERROR_REGISTRY.UNKNOWN_CLIENT_ERROR;
  }

  get kind(): ErrorKind {
    return this.meta.kind;
  }
  get expected(): boolean {
    return this.kind === "business";
  }
  get isOperational(): boolean {
    return this.kind !== "fault";
  }
  get severity(): Severity {
    return this.severityOverride ?? this.meta.severity;
  }
  get retryable(): boolean {
    return this.retryableOverride ?? this.meta.retryable;
  }
  get httpStatus(): HttpStatus {
    return this.meta.httpStatus;
  }
  get present(): PresentAction {
    return this.meta.present;
  }
  get log(): LogLevel {
    return this.meta.log;
  }
  get userMessageKey(): string {
    return this.meta.userMessageKey;
  }

  /** 활성 레지스트리에서 완전한 정책 번들을 해소한다 (resolvePolicy를 미러링한다). */
  resolve(): ResolvedPolicy {
    return resolvePolicy(getActiveErrorRegistry(), this.code, {
      severity: this.severityOverride,
      retryable: this.retryableOverride,
    });
  }

  toSerialized(): SerializedError {
    // JSON.parse(JSON.stringify(...))가 구조적으로 라운드트립되고 테스트에서의
    // deep-equality가 정확하도록(`correlationId: undefined` 같은 유령 키 없이) undefined 키를 생략한다.
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      ...(this.correlationId !== undefined ? { correlationId: this.correlationId } : {}),
      ...(this.digest !== undefined ? { digest: this.digest } : {}),
    };
  }

  /**
   * RSC/네트워크 경계를 넘은 일반 SerializedError로부터 일급(first-class) DomainError를
   * 재구성한다. 코드별 스키마에 대해 `details`를 재검증하고(makeError 스타일
   * 경로) code / correlationId / digest를 보존한다. 미스(miss) 시
   * 페이로드가 손상되었거나 위조된 것이다 → 런타임 UNKNOWN_* 코드로 폴백하되 여전히
   * correlationId + digest를 보유하여 지원 추적(support trail)이 살아남도록 한다.
   */
  static fromSerialized(s: SerializedError): DomainError {
    const parsed = ErrorDetailsSchema[s.code].safeParse(s.details);
    if (!parsed.success) {
      const fallback: ErrorCode =
        getRuntime() === "server" ? "UNKNOWN_SERVER_ERROR" : "UNKNOWN_CLIENT_ERROR";
      return construct(fallback, null, {
        message: s.message,
        cause: s.details,
        correlationId: s.correlationId,
        digest: s.digest,
      });
    }
    return construct(s.code, parsed.data, {
      message: s.message,
      correlationId: s.correlationId,
      digest: s.digest,
    });
  }
}

/**
 * code↔details 상관관계가 런타임에 확립되지만(Zod parse) 타입 시스템에는 증명할 수
 * 없는, 두 생성 경로(makeError, fromSerialized)를 위한 내부 팩토리:
 * ErrorDetailsMap에는 공통 멤버가 없으므로 제네릭 `ErrorDetailsMap[C]`는
 * `never`로 붕괴한다. 그 단 하나의(ONE) 캐스트가 여기에 산다; 기능 코드는 결코 캐스트하지 않는다.
 */
export const construct = (
  code: ErrorCode,
  details: unknown,
  rest: Omit<AppErrorOptions<ErrorCode>, "code" | "details"> = {},
): DomainError =>
  new DomainError({ code, details: details as ErrorDetailsMap[ErrorCode], ...rest });

export type AppError<C extends ErrorCode = ErrorCode> = DomainError<C>;

// 타입 가드 (시리즈에서 가져옴)
export const isDomainError = <C extends ErrorCode>(e: unknown, code?: C): e is DomainError<C> =>
  e instanceof DomainError && (!code || e.code === code);

/** 코드는 활성(ACTIVE) 레지스트리가 그것을 알고 있을 때에만(iff) "serialized-valid"이다. */
export const isSerializedError = (e: unknown): e is SerializedError =>
  typeof e === "object" &&
  e !== null &&
  "code" in e &&
  "message" in e &&
  typeof (e as SerializedError).code === "string" &&
  (e as SerializedError).code in getActiveErrorRegistry();

/**
 * *활성(active)* 레지스트리에서의 순수 의도 조회로, 대체된 카탈로그가
 * handleError + getter와 일관되게 `expected`를 지배하도록 한다. safeServerAction의
 * Track-1/Track-2 분기(§7.1)에서 사용된다. 레지스트리 없는(registry-free)
 * 코드에서 `@/error/app-error`로 재내보내진다(re-export).
 */
export const isExpectedCode = (code: ErrorCode): boolean =>
  (getActiveErrorRegistry()[code] ?? DEFAULT_ERROR_REGISTRY.UNKNOWN_CLIENT_ERROR).kind === "business";
```

**두 개의 표면, 하나의 출처.** 정책은 의도적으로 두 가지 방식으로 노출된다. (1) 권위 있는 푸시 기반 경로: `handleError`는 `deps.registry`에 대해 공유 `resolvePolicy()`를 호출하고, 호출별 `present`/`log` 오버라이드를 접어 넣은 뒤, `ResolvedAppError { error, code, policy }`를 반환한다. 호출자는 `result.policy`를 기반으로 UI를 구동하며 레지스트리를 다시 읽지 않는다. (2) 편의적인 풀 기반 경로: `err.httpStatus`, `err.userMessageKey`, `err.severity`, `err.present` 등은 동일한 `resolvePolicy` 로직을 통해 활성 레지스트리를 읽는다. 일단 바인딩되면 활성 레지스트리가 *곧* `deps.registry`이기 때문에, 두 표면은 모든 코드에 대해 동일한 값을 산출한다. `isExpectedCode`는 `app-error.ts`에 위치하며(`registry.ts`가 아니다), 따라서 `registry.ts`는 `registry ↔ active-registry` 임포트 순환이 없는 의존성 없는 SSOT(단일 진실 공급원) 리프로 유지된다.

**`expected`와 `isOperational`이 `kind`에서 파생되는 이유.** r5는 시리즈의 불리언 `expected`를 세 값을 가지는 의도 축인 `kind: ErrorKind`(`"business" | "operational" | "fault"`)로 대체하는데, 이는 하나의 불리언이 뭉뚱그렸던 의미 있는 구분을 인코딩한다. `business`는 사용자가 교정할 수 있는 예상된 결과이며(Track-1 / Result 셀렉터), `operational`은 여전히 "운영상"의 것이지만 코드 결함은 아닌 환경적/일시적 실패이고, `fault`는 의도하지 않은(expected) 결함이다. 시스템의 나머지가 읽는 두 불리언은 파생 별칭으로 노출되어 결코 `kind`에서 벗어날 수 없다: `expected`는 `kind === "business"`이고, `isOperational`은 `kind !== "fault"`이다(따라서 `business`와 `operational` 둘 다 운영상이다). `isOperational`은 우아한 UX를 시도할지(`true`) 아니면 500급 인시던트로 취급할지(`false`)를 가드하며, `expected`는 `isExpectedCode`를 통해 safeServerAction의 Track-1/Track-2 분기를 구동한다.

**Severity 대 LogLevel.** 시리즈는 severity를 `log`를 통해 *간접적으로* 인코딩한다. 사용자는 일급(first-class) `severity`를 명시적으로 원한다. 나는 이를 별도의 레지스트리 필드로 추가하고 `log`가 그것을 기본값으로 삼게 하여, "이것이 얼마나 시끄러운가"(severity, 알림/Sentry 레벨용 — 이제는 `Notifier` 게이트의 입력이기도 하다, §5)를 "이번 호출에서 이를 로깅하기는 하는가"(`log` 옵션)와 분리한다. 둘은 직교적이다: `severity:"error"` + `log:"none"`은 이미 보고된 에러에 대해 `error.tsx`가 사용하는 정확한 조합이다. r3는 severity를 알림에 대해 load-bearing(필수적인)으로 만든다(§5).


---
## 4. 주입된 `ERROR_REGISTRY`

### 4.1 타입

레지스트리 행(row)은 시리즈의 `ErrorMeta`에 필수 필드를 더해 확장한 것이며, 카탈로그 자체(`DEFAULT_ERROR_REGISTRY`, `ErrorMeta`, `ErrorCode`, `ErrorRegistry`)는 이제 **§3.1**에서 의존성 없는 SSOT(단일 진실 공급원) 리프(`error/registry.ts`)로 정의된다. 이는 여전히 `as const satisfies Record<string, ErrorMeta>`로 남아 있어 `ErrorCode`가 키에서 파생된 리터럴 유니온으로 유지된다. 이를 읽는 단일 런타임 권위는 맨몸의 `ERROR_REGISTRY` 글로벌이 아니라 *활성* 레지스트리(§3.2)다.

r5에서는 각 행이 두 개의 정책 축을 지니며, 이는 과거의 단일 boolean+`ux` 쌍을 대체한다:

- **`kind: ErrorKind`** (`"business" | "operational" | "fault"`) — 의도 축. `"business"`는 Track-1 / `Result` 선택자다(`isExpectedCode(code) === (registry[code].kind === "business")`). `"operational"`은 환경적/일시적인 것(non-fault)이고, `"fault"`는 의도하지 않은 결함이다. `DomainError` 게터는 이로부터 파생된다: `expected = kind === "business"`, `isOperational = kind !== "fault"`.
- **`present: PresentAction`** — 기준이 되는 사용자 가시적 영향(impact) 정책(과거의 `ux`). 과거의 `"none"`은 두 개의 별개 의미로 분리된다: `"inline"`(필드/폼 옆에 렌더링되는 비즈니스 인라인 오류, 예: `VALIDATION`, `NOT_FOUND`)과 `"silent"`(진정으로 조용한, 사용자 대면 영향이 전혀 없는 것, 예: `REQUEST_ABORTED`).

```ts
// error/registry.ts  — SSOT 리프. 맨몸의 ERROR_REGISTRY export 없음; DEFAULT만 있음.
// ============================================================================
import type { Severity } from "./severity";
import type { ErrorKind, PresentAction, LogLevel, HttpStatus } from "./policy";

export interface ErrorMeta {
  /** 의도 축 (r5 SSOT). business = Track-1/Result 선택자; 그 외에는 operational/fault. */
  readonly kind: ErrorKind;
  readonly severity: Severity; // 일급(first-class); 기본 로그 레벨 + Sentry 레벨을 구동
  readonly present: PresentAction; // 기준이 되는 사용자 가시적 영향(impact) 정책
  readonly log: LogLevel; // 기준이 되는 로그 정책
  readonly httpStatus: HttpStatus; // 401/403/404/500 차별화
  readonly retryable: boolean; // 재시도가 의미 있는가?
  readonly userMessageKey: string; // 사용자 대면 메시지용 i18n 키
}

export const DEFAULT_ERROR_REGISTRY = {
  // ── business (mutations: Result로 반환 / queries: throw 후 error.code 분기) ──
  VALIDATION:           { kind: "business",    severity: "info",    present: "inline",   log: "none",    httpStatus: 422, retryable: false, userMessageKey: "error.validation" },
  INVALID_CREDENTIALS:  { kind: "business",    severity: "info",    present: "inline",   log: "info",    httpStatus: 401, retryable: false, userMessageKey: "error.invalidCredentials" },
  AUTH_REQUIRED:        { kind: "business",    severity: "info",    present: "redirect", log: "info",    httpStatus: 401, retryable: false, userMessageKey: "error.authRequired" },
  FORBIDDEN:            { kind: "business",    severity: "warning", present: "page",     log: "warning", httpStatus: 403, retryable: false, userMessageKey: "error.forbidden" },
  NOT_FOUND:            { kind: "business",    severity: "info",    present: "inline",   log: "none",    httpStatus: 404, retryable: false, userMessageKey: "error.notFound" },
  // ── operational (환경적/일시적; non-fault) ──
  OFFLINE:              { kind: "operational", severity: "warning", present: "toast",    log: "warning", httpStatus: 503, retryable: true,  userMessageKey: "error.offline" },
  TIMEOUT:              { kind: "operational", severity: "warning", present: "toast",    log: "warning", httpStatus: 504, retryable: true,  userMessageKey: "error.timeout" },
  REQUEST_ABORTED:      { kind: "operational", severity: "info",    present: "silent",   log: "info",    httpStatus: 503, retryable: false, userMessageKey: "error.aborted" },
  NETWORK_ERROR:        { kind: "operational", severity: "warning", present: "toast",    log: "warning", httpStatus: 502, retryable: true,  userMessageKey: "error.network" },
  HTTP_CLIENT_ERROR:    { kind: "operational", severity: "warning", present: "toast",    log: "warning", httpStatus: 400, retryable: false, userMessageKey: "error.httpClient" },
  RATE_LIMITED:         { kind: "operational", severity: "warning", present: "toast",    log: "warning", httpStatus: 429, retryable: true,  userMessageKey: "error.rateLimited" },
  // ── fault (의도하지 않은 결함) ──
  HTTP_SERVER_ERROR:    { kind: "fault",       severity: "error",   present: "toast",    log: "error",   httpStatus: 500, retryable: true,  userMessageKey: "error.httpServer" },
  SCHEMA_MISMATCH:      { kind: "fault",       severity: "error",   present: "toast",    log: "error",   httpStatus: 502, retryable: false, userMessageKey: "error.schema" },
  UNKNOWN_SERVER_ERROR: { kind: "fault",       severity: "fatal",   present: "toast",    log: "error",   httpStatus: 500, retryable: false, userMessageKey: "error.unknown" },
  UNKNOWN_CLIENT_ERROR: { kind: "fault",       severity: "error",   present: "toast",    log: "error",   httpStatus: 500, retryable: false, userMessageKey: "error.unknown" },
} as const satisfies Record<string, ErrorMeta>;

/**
 * 주입 가능한 레지스트리. 대체된 카탈로그(호스트 확장 / 테스트 더블)는
 * `ErrorCode` 해소가 결코 누락되지 않도록 DEFAULT 키의 상위집합(superset)으로 유지되어야 한다;
 * 해소기(resolver)는 여전히 방어적으로 UNKNOWN_CLIENT_ERROR로 폴백한다.
 */
export type ErrorRegistry = Record<ErrorCode, ErrorMeta>;

/** 정규 코드의 리터럴 유니온 — DEFAULT 레지스트리 키에서 파생됨 (SSOT). */
export type ErrorCode = keyof typeof DEFAULT_ERROR_REGISTRY;

// NOTE: `isExpectedCode`는 app-error.ts에 있다(활성 레지스트리를 읽기 때문),
// registry.ts를 의존성 없는 SSOT 리프로 유지하고 active-registry.ts와의
// import 순환을 피한다. safeServerAction은 이를 "@/error/app-error"에서 import한다.
//
// NOTE: 맨몸의 `ERROR_REGISTRY` export는 의도적으로 없다. 단일
// 런타임 권위는 *활성* 레지스트리(active-registry.ts)다 — 컴포지션
// 루트에서 바인딩된 DEFAULT_ERROR_REGISTRY이거나 주입된 deps.registry 중 하나.
// 그 무엇도 모듈 레벨의 가변 카탈로그를 직접 읽지 않는다.
```

배선된 조각들이 참조하는 두 코드는 §3.1에서 일급(first-class) 레지스트리 행이다:

- **`FORBIDDEN`** (403) — 사용자에게는 401 코드(`INVALID_CREDENTIALS`/`AUTH_REQUIRED`)와 구분되는 403 차별화가 필요하다. §7 참조.
- **`RATE_LIMITED`** (429, `retryable:true`, `severity:"warning"`, `kind:"operational"`) — 재시도가 *되어야 하는* 유일한 4xx로, 공유 재시도 술어(§8.6)가 `HTTP_CLIENT_ERROR`(400, `retryable:false`)와 구별할 수 있도록 별도 코드로 유지된다.

`present:"page"`는 "전체 페이지 상태로 에스컬레이션"을 의미하는 실제 액션이며(서버에서는 Next 인터럽트 페이지, 클라이언트에서는 `error.tsx`/전용 라우트 에스컬레이션), §8.2에서 배선된다. `REQUEST_ABORTED`는 `present:"silent"`(사용자 가시적 영향이 전혀 없음)이며 `httpStatus: 503`으로 매핑된다(중단된 요청에는 실제 HTTP 상태가 없다 — 실무상 이 코드는 결코 응답을 생성하지 않는다).

### 4.2 코드별 `details` 스키마 (생성 시 검증됨)

```ts
// error/schema.ts
import { z } from "zod";
import type { ErrorCode } from "./registry";

export const ErrorDetailsSchema = {
  VALIDATION:           z.object({ fieldErrors: z.record(z.array(z.string())) }),
  INVALID_CREDENTIALS:  z.null(),
  AUTH_REQUIRED:        z.null(),
  FORBIDDEN:            z.object({ requiredRole: z.string().optional() }).nullable(),
  NOT_FOUND:            z.object({ resource: z.string().optional() }).nullable(),
  OFFLINE:              z.null(),
  TIMEOUT:              z.null(),
  REQUEST_ABORTED:      z.null(),
  NETWORK_ERROR:        z.null(),
  HTTP_CLIENT_ERROR:    z.object({ status: z.number() }).nullable(),
  RATE_LIMITED:         z.object({ retryAfterMs: z.number().int().nonnegative().optional() }).nullable(),
  HTTP_SERVER_ERROR:    z.object({ status: z.number() }).nullable(),
  SCHEMA_MISMATCH:      z.object({ endpoint: z.string().optional() }).nullable(),
  UNKNOWN_SERVER_ERROR: z.null(),
  UNKNOWN_CLIENT_ERROR: z.null(),
} as const satisfies Record<ErrorCode, z.ZodTypeAny>;

export type ErrorDetailsMap = { [K in ErrorCode]: z.infer<(typeof ErrorDetailsSchema)[K]> };
```

> `satisfies Record<ErrorCode, z.ZodTypeAny>` 가드는 스키마를 레지스트리에 기계적으로 결합한다: 스키마 항목 없이 코드(예: `RATE_LIMITED`)를 추가하면 컴파일 오류가 되며, §10의 "모든 `ErrorCode`는 스키마 항목을 가진다" 불변식 테스트가 CI에서 이를 강제한다. `RATE_LIMITED.details`는 `{ retryAfterMs?: number } | null`이다 — 재시도 레이어가 읽는 서버 `Retry-After` 힌트다(§8.6).

### 4.3 오류가 레지스트리 항목으로 해소되는 방식 — `runtime`, `make-error`, `normalize`(정규화)

해소(resolution)는 `code`에 의한 *순수 조회*이며, 공유 `resolvePolicy()`(§3.3)를 통해 `handleError` 내부에서 수행되고, 결코 기능 코드에 의해 수행되지 않는다. `makeError`는 단일 생성 경로다. details 검증 실패 시에는 `getRuntime()`이 선택하는 `UNKNOWN_SERVER_ERROR` / `UNKNOWN_CLIENT_ERROR`로 폴백한다(런타임 안전을 위해 호출별로 평가 — 결코 모듈 레벨 const가 아니다). `makeError`와 `fromSerialized`는 모두 단일 내부 `construct()` 팩토리(§3.3)를 거치며, 이곳에 유일한 `details` 캐스트가 국소화되어 있다.

```ts
// error/runtime.ts
export type Runtime = "server" | "client";
export const getRuntime = (): Runtime => (typeof window === "undefined" ? "server" : "client");
```

```ts
// error/make-error.ts  — construct()를 거쳐 라우팅됨(지금 컴파일됨);
// normalize.ts가 런타임 폴백을 공유하도록 unknownCodeForRuntime()을 export한다.
import { ErrorDetailsSchema } from "./schema";
import { DomainError, construct, type AppErrorOptions } from "./app-error";
import { getRuntime } from "./runtime";
import type { ErrorCode } from "./registry";

export const unknownCodeForRuntime = (): "UNKNOWN_SERVER_ERROR" | "UNKNOWN_CLIENT_ERROR" =>
  getRuntime() === "server" ? "UNKNOWN_SERVER_ERROR" : "UNKNOWN_CLIENT_ERROR";

export const makeError = <C extends ErrorCode>(opts: AppErrorOptions<C>): DomainError<C> => {
  const parsed = ErrorDetailsSchema[opts.code].safeParse(opts.details);
  if (!parsed.success) {
    // 프로덕션에서 여기에 도달하는 것 자체가 비정상이다 — 설계상, 프로그래머의 실수다.
    return construct(unknownCodeForRuntime(), null, {
      message: opts.message ?? "알 수 없는 오류가 발생했습니다.",
      cause: opts.cause ?? opts.details,
      correlationId: opts.correlationId,
      digest: opts.digest,
    }) as DomainError<C>;
  }
  return construct(opts.code, parsed.data, {
    message: opts.message,
    cause: opts.cause,
    severity: opts.severity,
    retryable: opts.retryable,
    correlationId: opts.correlationId,
    digest: opts.digest,
  }) as DomainError<C>;
};
```

**단일 처리 경로의 1단계: 직렬화 재수화(rehydration).** 이 설계의 핵심 약속은 "하나의 처리 경로, 다수의 전달 트랙"이며, 모든 트랙은 `handleError`/`handleServerError`로 깔때기처럼 모인다. 그 첫 행위가 `normalizeToDomainError(input, fallbackMessage?, correlationId?)`다. 또한 이곳에 시스템에서 가장 위험한 실패 모드가 자리한다: 서버에서 던져졌거나 `Result`의 `Failure`로 반환된 `DomainError`는 **클래스 인스턴스로서 RSC/네트워크 경계를 넘지 않는다** — 평범한 `SerializedError` JSON 객체만이 이동한다(Goal #4). 그래서 클라이언트의 `error.tsx`, TanStack `useQuery`의 `error`, 또는 `useActionState`의 `Failure`가 `handleError`에 도달할 무렵이면 `instanceof DomainError`는 이미 `false`다. 명시적인 재수화 분기가 없다면, 정규화는 서버에서 발원한 모든 오류를 `UNKNOWN_CLIENT_ERROR`로 오분류하여 실제 `code`, 레지스트리 정책, `correlationId`를 폐기하게 된다. `normalizeToDomainError`는 `handle-error.ts`(§5)가 import하는 파일이다.

```ts
// error/normalize.ts  — 단일 처리 경로의 1단계.
import {
  DomainError,
  isDomainError,
  isSerializedError,
  type SerializedError,
} from "./app-error";
import { makeError, unknownCodeForRuntime } from "./make-error";
import type { ErrorCode } from "./registry";

/**
 * 포착된 그 어떤 값이든 일급(first-class) DomainError로 강제 변환한다. 순서가 있는 분기 — 순서가
 * load-bearing이다:
 *   1. DomainError 인스턴스   → 반환(같은 런타임 throw); 없으면 ctx correlationId를 찍는다.
 *   2. 평범한 SerializedError → DomainError.fromSerialized (와이어를 넘었음; 클라이언트에서는
 *                              instanceof가 false다 — THE killer case).
 *   3. 진짜 Error             → 알려진 프레임워크/네트워크 형태를 매핑, 아니면 런타임별 UNKNOWN_*.
 *   4. 그 외 무엇이든          → 런타임별 UNKNOWN_*.
 * 와이어로 전달된 correlationId는 항상 요청별 correlationId보다 우선한다.
 */
export function normalizeToDomainError(
  input: unknown,
  fallbackMessage?: string,
  correlationId?: string,
): DomainError {
  if (isDomainError(input)) return stampCorrelation(input, correlationId); // 1

  if (isSerializedError(input)) {
    // 2
    const withId: SerializedError =
      input.correlationId === undefined && correlationId !== undefined
        ? { ...input, correlationId }
        : input;
    return DomainError.fromSerialized(withId);
  }

  if (input instanceof Error) {
    // 3
    const mapped = mapKnownError(input, correlationId);
    if (mapped) return mapped;
  }

  return makeError({
    // 3b / 4
    code: unknownCodeForRuntime() as ErrorCode,
    details: null,
    message: fallbackMessage ?? messageOf(input),
    cause: input,
    correlationId,
  });
}

/** 전용 코드를 부여할 만한 프레임워크/네트워크 Error 형태를 인식한다. */
function mapKnownError(error: Error, correlationId?: string): DomainError | null {
  if (error.name === "AbortError")
    return makeError({ code: "REQUEST_ABORTED", details: null, cause: error, correlationId });
  if (error.name === "TypeError" && /fetch|network/i.test(error.message)) {
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    return makeError({
      code: offline ? "OFFLINE" : "NETWORK_ERROR",
      details: null,
      cause: error,
      correlationId,
    });
  }
  if (error.name === "TimeoutError" || /timeout|ETIMEDOUT/i.test(error.message))
    return makeError({ code: "TIMEOUT", details: null, cause: error, correlationId });
  return null;
}

const stampCorrelation = (e: DomainError, correlationId?: string): DomainError => {
  if (e.correlationId !== undefined || correlationId === undefined) return e;
  // correlationId는 readonly다; 직렬화 계약을 통해 재구성하여 생성이
  // 단일의 검증된 경로로 유지되도록 한다(기존 인스턴스를 변이시키지 않음).
  return DomainError.fromSerialized({ ...e.toSerialized(), correlationId });
};

const messageOf = (input: unknown): string =>
  input instanceof Error
    ? input.message
    : typeof input === "string"
      ? input
      : "알 수 없는 오류가 발생했습니다.";

/**
 * @deprecated {@link normalizeToDomainError}를 사용하라. 과거의 `normalize()` 이름을 통합한다;
 * 마이그레이션 편의를 위해서만 유지되며, 다음 메이저에서 제거된다.
 */
export const normalize = normalizeToDomainError;
```

분기 순서(ORDER)는 load-bearing이다: `isDomainError`는 반드시 `isSerializedError`보다 앞서야 한다. 살아 있는 `DomainError` 인스턴스 또한 구조적으로 직렬화 가드를 만족하기 때문이다(`code`+`message`를 가지며 `code in getActiveErrorRegistry()`다). 둘을 뒤바꾸면 같은 런타임 오류를 불필요하게 `fromSerialized`로 왕복시키게 된다. `fromSerialized`는 `details`를 재검증하므로, 손상되거나 위조된 와이어 페이로드가 잘못된 details를 살아 있는 인스턴스에 밀반입할 수 없다. 실패 시에는 런타임 UNKNOWN_* 코드로 폴백하되 여전히 `correlationId` + `digest`를 지닌다. 이 왕복은 직접 단언된다(§10): `normalize(err.toSerialized())`는 `normalize(err)`와 deep-equal이다.

### 4.4 레지스트리가 **제공되는** 방식 (import이 아니라 주입(DI))

레지스트리는 교체 가능해야 한다(호스트 앱이 확장하고, 테스트가 대체한다). 런타임에 따라 선택되는 두 가지 메커니즘이 있다:

- **클라이언트:** React 컨텍스트(읽기 전용)와, `initHandleError`에 건네지는 동일 인스턴스를 함께 둔다. `initHandleError`는 `setActiveErrorRegistry(deps.registry)`(§3.2)도 호출하여 게터들이 일치하게 한다. 기능 컴포넌트는 결코 레지스트리를 직접 읽지 않는다 — 대신 `handleError`가 반환한 *정규화된 AppError*(또는 `present` 필드가 전달 트랙을 선택하는 `ResolvedAppError.policy`)를 읽는다. 컨텍스트는 드문 표현용 조회(예: 디버그 패널의 code→label 맵)를 위해서만 존재한다.
- **서버:** 레지스트리는 `createHandleError(deps)`의 생성자 의존성이며, 요청별 작업은 `runWithErrorRegistry(deps.registry, …)`(§3.2/§7.1a)로 감싸여 활성 레지스트리가 요청 범위로 스코프된다. 컨텍스트는 없다 — 서버 해소는 전적으로 요청별 핸들러 인스턴스 내부에서 일어난다.

```ts
// error/registry-context.tsx  ('use client')
import { createContext, useContext } from "react";
import { DEFAULT_ERROR_REGISTRY, type ErrorRegistry } from "./registry";

const RegistryContext = createContext<ErrorRegistry>(DEFAULT_ERROR_REGISTRY);
export const ErrorRegistryProvider = RegistryContext.Provider;
export const useErrorRegistry = () => useContext(RegistryContext);
```

```ts
// error/types.ts — deps 백(bag)이 싱크와 함께 레지스트리를 운반한다.
// registry는 Record<ErrorCode, ErrorMeta>로 좁혀진다; Notifier 싱크를 포함하여
// (각 컴포지션 루트에서 noopNotifier로 기본값 설정), handleError가 알림을 보낼 수 있다.
import type { ErrorRegistry } from "./registry";
import type { Reporter, Presenter } from "./telemetry";
import type { Notifier } from "./notifier";

export interface HandleErrorDeps {
  registry: ErrorRegistry;     // = Record<ErrorCode, ErrorMeta> (§3.1)
  reporter: Reporter;          // §5 — 모니터링(Sentry / console); 이제 breadcrumb()도
  presenter: Presenter;        // §5 — UX (toast / 서버에서는 no-op)
  notifier: Notifier;          // §5 — 알림(pager); 기본값 noopNotifier
}
```

> `Translator`는 설계상 `HandleErrorDeps`에 **없다** — 메시지 해소는 렌더 타임의 관심사이지 `handleError` 파이프라인의 일부가 아니다(`Translator`는 함수이며 RSC 경계를 넘지 못한다). i18n은 렌더 타임에 `resolveErrorMessage`(§6.3)를 통해 `AppError.userMessageKey`를 읽으며, §5의 단일 처리 경로 / 직렬화 안전성을 보존한다. Reporter/Presenter를 넘어 파이프라인에 주입되는 유일한 싱크는 `Notifier`(알림)다.

r5에서 이 싱크들은 4단계 `handleError` 파이프라인을 구동하며, 이 파이프라인은 해소된 `present` 정책을 기준으로 분기한다: (1) `log !== "none"`일 때 fault를 Reporter에 **보고(report)**하고, (2) **알림(notify)**(알림)하며, (3) `present "toast"`/`"alert"`에 대해서만 **Presenter를 호출**하고, (4) `present !== "silent"`일 때마다 **영향(impact) breadcrumb(브레드크럼)을 방출**한다(`reporter.breadcrumb(...)`) — 그리하여 fault는 Reporter에 의해 한 번 포착되고, *사용자 가시적 영향(impact)*은 breadcrumb으로 별도 기록된다. 이 분리는 과거의 중복 로깅 금지 혼동(impact 추적이 fault 포착과 얽혀 있던 문제)을 해소한다. 이를 지원하기 위해 `Reporter` 인터페이스에 `breadcrumb()` 메서드가 추가되었고, `TelemetryContext`에 선택적 `traceId?`(OTel 이음새, 현재 미사용)가 추가되었다.

이는 강한 요구사항을 문자 그대로 충족한다: `ERROR_REGISTRY`는 `HandleErrorDeps`의 한 필드로, 컴포지션 루트에서 주입되고 `DEFAULT_ERROR_REGISTRY`로 기본값이 설정되지만 `handleError` 본문에서는 결코 하드 참조되지 않는다 — 그리고 *활성* 레지스트리(§3.2)는 양쪽 런타임 모두에서 init 시점/요청별로 바인딩되고 나면 주입된 그것임이 증명 가능하다.


---
## 5. 리포팅 추상화 — `Reporter` + `Presenter` + `Notifier`

이 시리즈는 두 개의 싱크를 제공하며, r3에서 세 번째 싱크가 추가된다. **`Reporter`**(모니터링 싱크 — Sentry 계열, 콘솔 reporter로 팬아웃될 수 있다), **`Presenter`**(UX 싱크 — 클라이언트에서는 sonner toast, 서버에서는 no-op), 그리고 **`Notifier`**(알림 싱크 — 심각도가 정당화될 때 온콜에게 페이지를 보내며, `AlertPolicy`로 게이트되고, 클라이언트에서는 no-op)이다. 세 가지 모두 주입(DI)되며, 벤더 SDK는 오직 어댑터 내부에서만 import된다.

**r5는 `Reporter`를 두 채널로 확장한다.** `report()`(fault 캡처 채널)와 더불어 `breadcrumb()`(사용자 **영향(impact)** 채널)을 갖는다. `handleError`는 `report()`를 통해 fault를 *한 번* 캡처한 다음 — 사용자에게 실제로 무언가가 전달된 경우(`present !== "silent"`)에 한해 — 사용자에게 보인 영향(impact)을 `reporter.breadcrumb()`을 통해 별도로 기록하며, 이는 `correlationId`로 키가 지정되고 로그 레벨과 독립적이다. breadcrumb의 `surface` 인자는 사용자가 실제로 경험한 해소된 `PresentAction`(`inline`/`toast`/`alert`/…)이므로, 모니터링 트레이스는 중복 캡처 없이 "무엇이 깨졌는가"와 "사용자가 무엇을 보았는가"를 모두 보여준다. 이것이 과거의 중복-로깅-금지 혼동을 해소하는 이음매(seam)이다. fault와 영향(impact)은 이제 같은 싱크 위의 서로 구별되는 신호이며, 두 번 방출하기를 두려워했던 하나의 신호가 아니다. `Presenter`는 가시적 크롬 surface를 갖는 `present` 값(`"toast"`/`"alert"`)에 대해서만 도달되며, `"inline"` business 오류는 presenter 호출 없이 필드 옆에 렌더링되고, `"silent"` 액션(진정으로 silent한 것, 예: `REQUEST_ABORTED`)은 presenter 호출도 breadcrumb도 생성하지 않는다.

> **분석(Analytics)은 의도적으로 여기에 두지 않는다.** 제품 분석(GA/Amplitude)은 다른 형태(예외 객체가 아니라 명명된 이벤트 + 속성)와 다른 생명주기를 가지며, "오류가 발생했다"를 오류 파이프라인을 통해 라우팅하는 것은 서로 무관한 두 관심사를 결합시킨다. 오류를 제품 지표로 삼고 싶다면 feature/UI 레이어에서 방출하라 — 결코 `handleError`에서 방출해서는 안 된다. §11을 보라.

`TelemetryContext`는 correlation ID + 사용자 컨텍스트를 실어 나르므로 이들은 모든 Sentry 이벤트와 로그 라인에 함께 따라간다. **r3:** `runtime`은 `"server" | "client"`로 좁혀졌다 — Next 16에는 "edge" 런타임이 없다(프록시 경계는 Node.js 런타임에서 실행된다, §9). **r5:** 이는 또한 선택적 `traceId`를 실어 나른다 — 향후 OpenTelemetry 트레이스 상관관계를 위한 이음매로, 오늘날에는 사용되지 않지만 변경 없이 꿰어져 있어 어댑터가 컨텍스트 변경 없이 이를 활성화할 수 있다.

```ts
// error/telemetry.ts
// 텔레메트리 인터페이스 (설계 §5). 두 개의 싱크: Reporter (모니터링) + Presenter (UX).
// 세 번째 싱크 (Notifier / 알림)는 자신의 AlertPolicy와 함께 ./notifier 에 산다.
import type { DomainError } from "./app-error";
import type { LogLevel, PresentAction } from "./policy";

/** 모든 신호에 함께 따라가는 안정적인 컨텍스트. */
export interface TelemetryContext {
  correlationId?: string;
  user?: { id: string; role?: string } | null;
  route?: string;
  runtime: "server" | "client"; // r3: Next 16 에는 "edge" 런타임이 없다
  /** 향후 OTel 트레이스 상관관계를 위한 이음매. r5 에서는 미사용이며 변경 없이 실어 나른다. */
  traceId?: string;
}

/** 모니터링 싱크 (Sentry 계열; composite 는 콘솔로도 팬아웃할 수 있다). */
export interface Reporter {
  report(error: DomainError, level: LogLevel, ctx: TelemetryContext): void;
  /**
   * 오류의 사용자에게 보이는 영향(IMPACT)을 (T1 영향 breadcrumb) 재캡처 없이
   * 기록한다: ctx.correlationId 로 키가 지정되며, 로그 레벨과 독립적이다. `surface`
   * 는 사용자가 실제로 경험한 해소된 PresentAction (inline/toast/…) 이다.
   */
  breadcrumb(error: DomainError, surface: PresentAction, ctx: TelemetryContext): void;
  setUser(user: TelemetryContext["user"]): void;
  setContext(ctx: Partial<TelemetryContext>): void;
}

/** 사용자 대면 UX 싱크 (sonner / 서버에서는 no-op). */
export interface Presenter {
  present(error: DomainError, action: PresentAction, ctx: TelemetryContext): void;
}
```

### 5.1 세 번째 싱크 — `Notifier` + `AlertPolicy` (심각도 → 알림)

레지스트리의 `severity` 필드는 이미 (`Reporter`를 통해) Sentry *level*을 설정하고 *log* 레벨의 기본값을 정한다. r3은 그것의 세 번째 역할 — "severity:`fatal`은 온콜에게 페이지를 보내야 한다" — 을 세 번째 주입된 싱크인 `Notifier`로 배선하며, 이는 `Reporter`/`Presenter`와 정확히 동일하게 정의되고 조합되어 그들의 모든 보장을 상속한다. 어떤 feature 파일도 페이저 SDK를 import하지 않는다. PagerDuty/Opsgenie/Slack의 존재를 아는 유일한 파일은 교체 가능한 `PagerTransport` 뒤의 `adapters/pager-notifier.ts`이다. "페이지를 보낼 만큼 충분히 시끄러운가?"라는 결정은 *메커니즘이 아니라 정책*이다 — 그래서 이는 데이터 주도형 `AlertPolicy` 안에 산다.

> **모듈 맵 적응.** 설계는 원래 `AlertPolicy`를 자체 `error/alert-policy.ts`로 분리했다. 정본 r5 모듈 맵은 `AlertPolicy`를 `Notifier`와 함께 배치하므로, 정책 인터페이스와 임계값/게이트 헬퍼는 `error/notifier.ts`(아래 참조)로 병합된다. 두 절반은 라벨이 붙은 섹션 배너 아래에 유지된다.

```ts
// error/notifier.ts
// 세 번째 싱크 (설계 §5.1)로, Reporter/Presenter 와 정확히 동일하게 주입되며, 이를
// 게이트하는 AlertPolicy 를 더한다. Reporter 는 "디버깅을 위해 기록한다"에 답하고; Notifier 는
// "지금 사람을 깨운다"에 답한다. AlertPolicy 는 "이것이 페이지를 보낼 만큼 시끄러운가?"이다 — 순수하고,
// 데이터 주도형이며, 테스트 가능하다.
//
// 참고 (모듈 맵 적응): 설계는 AlertPolicy 를 별도의
// `alert-policy.ts` 로 분리했다. 정본 모듈 맵은 AlertPolicy 를 Notifier 와 함께
// 여기에 배치하므로, 정책 인터페이스 + 임계값/게이트 헬퍼가 이 파일로 병합된다.
import type { Severity } from "./severity";
import type { DomainError } from "./app-error";
import type { TelemetryContext } from "./telemetry";

// ── AlertPolicy ─────────────────────────────────────────────────────────────
// 심각도 순서는 error/severity.ts 를 반영한다: fatal > error > warning > info.
const SEVERITY_RANK: Record<Severity, number> = { info: 0, warning: 1, error: 2, fatal: 3 };

export const compareSeverity = (a: Severity, b: Severity): number =>
  SEVERITY_RANK[a] - SEVERITY_RANK[b];

export interface AlertPolicy {
  /** 이 심각도, 이 컨텍스트의 오류가 온콜에게 페이지를 보내야 하는지 결정한다. */
  shouldPage(error: DomainError, severity: Severity, ctx: TelemetryContext): boolean;
}

export interface ThresholdPolicyOptions {
  /** 페이지를 보내는 최소 심각도. 기본 "fatal" — 진짜 인시던트만 누군가를 깨운다. */
  readonly threshold?: Severity;
  /** 선택적 하드 억제 (예: 클라이언트 런타임 오류에는 결코 페이지를 보내지 않음). */
  readonly suppressRuntimes?: ReadonlyArray<TelemetryContext["runtime"]>;
}

/**
 * 기본 정책: severity >= threshold AND runtime 이 억제되지 않은 경우에만 페이지를 보낸다.
 * 심각도는 인자로 전달되며 (handleError 가 registry/override 로부터 이미 해소함),
 * 따라서 정책은 결코 레지스트리를 재독하지 않는다 — 상류의 단일 진실 공급원.
 */
export const thresholdAlertPolicy = (opts: ThresholdPolicyOptions = {}): AlertPolicy => {
  const threshold: Severity = opts.threshold ?? "fatal";
  const suppressed = new Set<TelemetryContext["runtime"]>(opts.suppressRuntimes ?? []);
  return {
    shouldPage(_error, severity, ctx) {
      if (suppressed.has(ctx.runtime)) return false;
      return compareSeverity(severity, threshold) >= 0;
    },
  };
};

// ── Notifier ────────────────────────────────────────────────────────────────
export interface Notifier {
  /** 발사-후-망각(fire-and-forget) 알림. 절대 throw 하지 않으며 handleError 를 블록하지 않아야 한다. */
  notify(error: DomainError, severity: Severity, ctx: TelemetryContext): void;
}

/** 선택적 싱크: 페이징이 비활성화된 경우(테스트 / 로컬 / 프리뷰) 이를 조합한다. */
export const noopNotifier: Notifier = { notify() {} };

const guardN = (fn: () => void): void => {
  try {
    fn();
  } catch {
    /* 알림은 결코 앱으로 throw 해서는 안 된다 — compositeReporter 와 동일한 불변식 */
  }
};

/** N 개의 notifier 로 팬아웃; 어댑터별 실패를 삼킨다. 자기 자신도 Notifier 이다. */
export const compositeNotifier = (...n: Notifier[]): Notifier => ({
  notify: (e, s, c) => n.forEach((x) => guardN(() => x.notify(e, s, c))),
});

/**
 * 전달 Notifier 를 AlertPolicy 게이트로 감싼다. handleError 는 항상
 * notifier.notify() 를 호출하며; 게이트가 페이지가 실제로 나가는지 결정하므로,
 * 임계값 로직은 (하드코딩되지 않고) 주입된다 (환경별로 교체 가능).
 */
export const policyGatedNotifier = (policy: AlertPolicy, delivery: Notifier): Notifier => ({
  notify: (error, severity, ctx) => {
    if (policy.shouldPage(error, severity, ctx)) delivery.notify(error, severity, ctx);
  },
});
```

```ts
// error/adapters/pager-notifier.ts
// 페이저 벤더가 존재함을 아는 유일한 파일. 교체 가능: PagerDuty / Opsgenie
// / Slack 은 하나의 webhook 형태 뒤의 세 가지 PagerTransport 구현이다.
import "server-only"; // 페이징은 서버 런타임에 속한다; 결코 클라이언트로 번들되지 않는다
import type { Notifier } from "../notifier";
import type { DomainError } from "../app-error";
import type { Severity } from "../severity";
import type { TelemetryContext } from "../telemetry";

export interface PageEvent {
  readonly title: string;
  readonly severity: Severity;
  readonly code: string;
  readonly correlationId?: string;
  readonly route?: string;
  readonly runtime: TelemetryContext["runtime"];
  readonly dedupKey: string; // 같은 code 의 폭주를 하나의 인시던트로 합친다
}

/** PagerDuty Events API v2, Opsgenie, 또는 Slack webhook 을 가리키도록 이것을 교체한다. */
export interface PagerTransport {
  send(event: PageEvent): Promise<void>;
}

const toPageEvent = (error: DomainError, severity: Severity, ctx: TelemetryContext): PageEvent => ({
  title: `[${severity.toUpperCase()}] ${error.code}: ${error.message}`,
  severity,
  code: error.code,
  correlationId: ctx.correlationId,
  route: ctx.route,
  runtime: ctx.runtime,
  // code+route 로 중복 제거하여 재시도/새로고침-루프가 온콜에게 스팸을 보내지 않게 한다.
  dedupKey: `${error.code}:${ctx.route ?? "unknown"}`,
});

/**
 * 기본 페이저 Notifier. notify() 는 동기-반환(발사-후-망각)이다: 비동기 send 를
 * 시작하고 결코 await 하지 않으므로, handleError 는 논블로킹으로 유지된다. 트랜스포트
 * 실패는 삼켜진다 (그리고 콘솔에 자기 보고된다) — 알림은 결코 throw 해서는 안 된다.
 */
export const createPagerNotifier = (transport: PagerTransport): Notifier => ({
  notify(error, severity, ctx) {
    void transport.send(toPageEvent(error, severity, ctx)).catch((cause) => {
      console.error({ tag: "[pager-failed]", code: error.code, cause });
    });
  },
});

/** 레퍼런스 트랜스포트: 범용 incoming-webhook 어댑터 (Slack 형태). */
export const webhookPagerTransport = (webhookUrl: string): PagerTransport => ({
  async send(event) {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: event.title,
        // PagerDuty Events API v2 교체: { routing_key, dedup_key: event.dedupKey,
        //   event_action: "trigger", payload: { summary: event.title, severity: event.severity,
        //   source: event.route ?? "app", custom_details: { code, correlationId, runtime } } }
        dedup_key: event.dedupKey,
        severity: event.severity,
        custom_details: {
          code: event.code,
          correlationId: event.correlationId,
          route: event.route,
          runtime: event.runtime,
        },
      }),
    });
  },
});
```
### 5.2 직렬화기는 누출 방지 강제 지점이다

목표 #4("구성에 의한 직렬화 안전")는 *어떤 클래스 인스턴스도 경계를 넘지 않는다*는 것을 의미했다. r3은 더 조용한 틈을 닫는다 — 직렬화된 페이로드의 *내용물*이다. `DomainError.toSerialized()`(§3.3)는 개발자 대상 `message`와 게이팅되지 않은 전체 `details`를 브라우저로 전달한다. 그것이 바로 누출이다. r5는 직렬화를 대상(audience)별로 분리하고 클라이언트로 향하는 모든 경로를 안전한 쪽으로 라우팅한다. 내부/서버 로그 형태 — `message` + 게이팅되지 않은 `details`를 유지하는 — 는 콘솔 reporter와 브라우저에 결코 도달하지 않는 모든 서버 대 서버 채널에서 인라인으로 구성된다. `toClientSerialized(err, digest?)`가 **강제 지점**이다. 이것은 `{ code, userMessageKey, correlationId?, digest?, details? }`를 방출한다 — 자유 텍스트 `message`는 없다(문구는 `userMessageKey`로부터 클라이언트 측에서 해결된다, §6.3) — 그리고 `details`는 요청별 코드별 allowlist를 통과하며 이는 *실패 시 닫힘(fails closed)*이다.

allowlist는 이제 코드별 Zod 스키마에 대해 타입이 지정된다. 배열 분기는 `ReadonlyArray<AllowedKeys<C>>`이며, 여기서 `AllowedKeys<C> = Extract<keyof NonNullable<ErrorDetailsMap[C]>, string>`이다 — 따라서 코드별 details 스키마에 없는 키는 조용한 죽은 짐이 아니라 **컴파일 오류**가 된다. r5는 또한 `RATE_LIMITED.retryAfterMs`를 allowlist로 옮긴다. 이것은 공개 Retry-After 값이며, 클라이언트 문구가 필요로 하는 비민감 카운트다운 숫자다(이것은 Presenter의 `{seconds}` 보간을 구동한다, §5.3 / §6.3). 따라서 직렬화 전에 소비되는 대신 경계를 넘는다.

```ts
// error/serialize-client.ts  — 누출 방지 강제 지점
// 오류가 CLIENT 에 도달하는 유일한 경로. 내부/서버 직렬화는
// `message` 를 유지한다; 클라이언트 직렬화는 그것을 버리고 allowlist 로 `details` 를 게이팅한다.
// app-error.ts 가 이 파일을 import 하지 않도록 자유 함수(메서드 아님)로 둔다(순환 없음).
import type { ErrorCode } from "./registry";
import type { ErrorDetailsMap } from "./schema";
import type { DomainError } from "./app-error";

/**
 * 클라이언트로 향하는 DTO. 참고: 자유 텍스트 `message` 필드 없음 — 문구는
 * `userMessageKey`(i18n)로부터 클라이언트에서 해결된다. 이것은 Result.Failure(§7.1)와
 * Route Handlers(§7.4)를 통해 브라우저로 넘어가는 타입이다.
 */
export interface ClientSerializedError {
  readonly code: ErrorCode;
  readonly userMessageKey: string;
  readonly correlationId?: string;
  readonly digest?: string;
  /** details 가 allowlist 에 등록된 코드에 대해서만, 그리고 선택된 필드만 Present. */
  readonly details?: unknown;
}

/**
 * 클라이언트로 향하는 `details` 를 위한 코드별 allowlist. 각 항목은 브라우저로 넘어갈 수 있는
 * 키의 정확한 집합이다. 부재하는(또는 `null` 로 매핑된) 코드는 details 를 전혀 보내지 않는다.
 *   VALIDATION.fieldErrors    → YES (사용자는 어떤 필드가 실패했는지 봐야 한다)
 *   RATE_LIMITED.retryAfterMs → YES (공개 Retry-After 값; 비민감 카운트다운 문구)
 *   SCHEMA_MISMATCH.endpoint  → NO  (내부 API 토폴로지를 누출함)
 *   FORBIDDEN.requiredRole    → NO  (인가 모델을 누출함)
 *   NOT_FOUND.resource        → NO  (내부 리소스 이름을 누출함)
 *   HTTP_*.status             → 서버 진단용이며, 사용자 문구가 아님
 * 모든 ErrorCode 에 대해 키가 지정되므로 결정 없이 코드를 추가하면 컴파일 오류가 된다.
 *
 * G1: 배열 분기는 `ReadonlyArray<Extract<keyof <details>, string>>` 로 타입이 지정되므로
 * 코드별 Zod 스키마에 없는 키는 이제 COMPILE 오류가 된다(조용한 죽은 짐이 아님).
 * `NonNullable<…>` 가 `.nullable()` 을 벗겨내어 객체 키가 `keyof` 를 통과해 살아남는다.
 */
type DetailsPicker = (d: unknown) => unknown;
type AllowedKeys<C extends ErrorCode> = Extract<keyof NonNullable<ErrorDetailsMap[C]>, string>;

export const DETAILS_ALLOWLIST: {
  [C in ErrorCode]: ReadonlyArray<AllowedKeys<C>> | DetailsPicker | null;
} = {
  VALIDATION: ["fieldErrors"],
  INVALID_CREDENTIALS: null,
  AUTH_REQUIRED: null,
  FORBIDDEN: null, // requiredRole 는 의도적으로 보류됨
  NOT_FOUND: null, // resource 는 의도적으로 보류됨
  OFFLINE: null,
  TIMEOUT: null,
  REQUEST_ABORTED: null,
  NETWORK_ERROR: null,
  HTTP_CLIENT_ERROR: null, // status 보류됨
  RATE_LIMITED: ["retryAfterMs"], // 공개 Retry-After 값 — 카운트다운 문구를 구동함
  HTTP_SERVER_ERROR: null, // status 보류됨
  SCHEMA_MISMATCH: null, // endpoint 보류됨
  UNKNOWN_SERVER_ERROR: null,
  UNKNOWN_CLIENT_ERROR: null,
};

/** 일반 객체에서 allowlist 에 등록된 키만 얕게 선택한다; 나머지는 모두 버린다. */
const pickAllowed = (
  details: unknown,
  keys: ReadonlyArray<string>,
): Record<string, unknown> | undefined => {
  if (details === null || typeof details !== "object") return undefined;
  const src = details as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  let hit = false;
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(src, k)) {
      out[k] = src[k];
      hit = true;
    }
  }
  return hit ? out : undefined;
};

/** 오류의 details 를 allowlist 를 통해 게이팅한다. 필드를 전부 생략하려면 `undefined` 를 반환한다. */
export const gateClientDetails = (code: ErrorCode, details: unknown): unknown => {
  const rule = DETAILS_ALLOWLIST[code];
  if (rule === null) return undefined;
  if (typeof rule === "function") {
    const picked = rule(details);
    return picked == null ? undefined : picked;
  }
  return pickAllowed(details, rule);
};

/**
 * 강제 지점. DomainError 로부터 클라이언트로 향하는 DTO 를 구성하며,
 * 자유 텍스트 message 를 버리고 details 를 게이팅한다. `digest`(RSC)는 존재할 때 함께 전달된다.
 */
export const toClientSerialized = (error: DomainError, digest?: string): ClientSerializedError => {
  const details = gateClientDetails(error.code, error.details);
  const dto: ClientSerializedError = {
    code: error.code,
    userMessageKey: error.userMessageKey,
    correlationId: error.correlationId,
    ...(digest !== undefined ? { digest } : {}),
    ...(details !== undefined ? { details } : {}),
  };
  return dto;
};
```

> 내부/서버 로그 형태(§3.3의 `SerializedError` — `{ code, message, details, correlationId }`)는 더 이상 직렬화기 모듈에서 `toInternalSerialized`로 내보내지지 않는다. 이것은 `message` + 게이팅되지 않은 `details`를 유지하므로, 소비되는 곳에 위치한다: 콘솔 reporter(§5.3)에서 인라인으로 구성된다. 클라이언트 직렬화기 모듈은 오직 클라이언트로 향하는, 누출이 게이팅된 경로만 내보내며, 이는 경계 파일이 자신의 단 하나의 임무에 정직하도록 유지한다.
### 5.3 어댑터 — 강화된 Sentry, console, 가드된 composite, sonner presenter

Sentry 어댑터는 모니터링 경로에서 벤더 SDK를 import 하는 유일한 파일이다. r3는 이를 강화한다: (1) `beforeSend` PII 스크럽 + 동일한 allowlist에 의한 `details` 편집(redaction); (2) 안정적인 그룹화를 위한 `fingerprint:[error.code]`; (3) `window.onerror`/`onunhandledrejection` 폭주에 대한 토큰 버킷 throttle; (4) 전송 실패를 스스로 결코 삼키지 않는다 — composite의 dead-man-switch(데드맨 스위치)가 이를 집계할 수 있도록 전파시킨다. r5는 **영향(impact) breadcrumb(브레드크럼)**을 추가한다: `breadcrumb(error, surface, ctx)`는 Sentry breadcrumb(브레드크럼)(카테고리 `error.presented`)을 추가하는 것이지 *재캡처가 아니므로*, 사용자에게 보이는 영향(impact)이 `correlationId`를 통해 다음에 캡처되는 이벤트에 꿰매어져, 단일 fault 캡처와는 별도로 영향(impact)을 기록한다. 토큰 버킷은 이제 **누적 드롭 총계**(`droppedTotal()`)도 추적하며, 이는 reporter와 캡처된 이벤트의 `app` 컨텍스트 양쪽에 노출되어 `throttled{n}` 집계가 폭주 가드가 얼마나 많은 브라우저 경계 이벤트를 떨궈냈는지 읽어낼 수 있게 한다.

```ts
// error/adapters/sentry-reporter.ts  — HARDENED (design §5.3)
// 모니터링 경로에서 벤더 SDK를 import 하는 유일한 파일.
// (1) beforeSend PII 스크럽 + 동일한 allowlist에 의한 details 편집(redaction);
// (2) 안정적인 그룹화를 위한 fingerprint:[error.code];
// (3) window.onerror/onunhandledrejection 폭주에 대한 토큰 버킷 throttle;
// (4) 전송 실패를 스스로 결코 삼키지 않는다 — composite
//     dead-man's-switch가 이를 집계할 수 있도록 전파시킨다.
import * as Sentry from "@sentry/nextjs";
import type { Reporter, TelemetryContext } from "../telemetry";
import type { DomainError } from "../app-error";
import type { LogLevel } from "../policy";
import { gateClientDetails } from "../serialize-client";
import { isExpectedCode } from "../app-error";
import type { ErrorCode } from "../registry";

// @sentry/nextjs v8 SeverityLevel은 "fatal"|"error"|"warning"|"log"|"info"|"debug"이다.
// 우리는 사용하는 네 가지만 방출한다; 타입은 실제 Sentry union이므로 scope.setLevel과 일치한다.
const toSentryLevel = (level: LogLevel): Sentry.SeverityLevel =>
  level === "fatal"
    ? "fatal"
    : level === "warning"
      ? "warning"
      : level === "info"
        ? "info"
        : "error";

/** extra/contexts에 나타나는 곳이면 어디든 그 VALUE가 스크럽되는 키들. */
const PII_KEYS = new Set([
  "email",
  "token",
  "access_token",
  "refresh_token",
  "authorization",
  "password",
  "cookie",
  "set-cookie",
  "api_key",
  "apikey",
  "secret",
]);
const TOKEN_RE = /\b(?:eyJ[\w-]{10,}|[A-Za-z0-9_-]{40,}|Bearer\s+[\w.-]+)\b/g;

const scrubString = (s: string): string => s.replace(TOKEN_RE, "[redacted-token]");

/** PII 키 + 토큰 형태의 문자열을 재귀적으로 편집(redact)한다. 순환/거대 객체가 beforeSend를 멈추게 하지 못하도록 깊이를 제한한다. */
const scrubDeep = (value: unknown, depth = 0): unknown => {
  if (depth > 6) return "[redacted-depth]";
  if (typeof value === "string") return scrubString(value);
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = PII_KEYS.has(k.toLowerCase()) ? "[redacted]" : scrubDeep(v, depth + 1);
    }
    return out;
  }
  return value;
};

/** 단순한 monotonic-time 토큰 버킷. capacity 개의 토큰, `ratePerSec`로 리필됨. */
interface TokenBucket {
  allow(): boolean;
  /** 현재 연속된 throttled 구간에서의 드롭 수 (다음 allow에서 0으로 리셋됨). */
  droppedSinceLastAllow(): number;
  /** 지금까지의 모든 드롭의 RUNNING 총계 (G4/G5) — 결코 리셋되지 않음; throttled{n} 집계용. */
  droppedTotal(): number;
}
const makeTokenBucket = (
  capacity: number,
  ratePerSec: number,
  now: () => number = () => Date.now(),
): TokenBucket => {
  let tokens = capacity;
  let last = now();
  let dropped = 0;
  let droppedTotalCount = 0;
  return {
    allow() {
      const t = now();
      tokens = Math.min(capacity, tokens + ((t - last) / 1000) * ratePerSec);
      last = t;
      if (tokens >= 1) {
        tokens -= 1;
        dropped = 0; // 누적 총계가 아니라 CONTIGUOUS-run 카운터를 리셋한다.
        return true;
      }
      dropped += 1;
      droppedTotalCount += 1; // running 총계는 allow를 가로질러 유지된다.
      return false;
    },
    droppedSinceLastAllow() {
      return dropped;
    },
    droppedTotal() {
      return droppedTotalCount;
    },
  };
};

export interface SentryReporterConfig {
  /** 폭주 가드: throttling 전 윈도우당 허용되는 최대 브라우저 경계 이벤트 수. */
  browserBurstCapacity?: number; // 기본값 5
  browserRefillPerSec?: number; // 기본값 1
}

/** Reporter + running throttle-drop 총계로, `throttled{n}` 집계가 이를 읽을 수 있도록 함. */
export interface SentryReporter extends Reporter {
  /** 폭주 throttle에 의해 드롭된 브라우저 경계 이벤트의 RUNNING 총계 (G4/G5). */
  droppedTotal(): number;
}

export const createSentryReporter = (config: SentryReporterConfig = {}): SentryReporter => {
  const browserBucket = makeTokenBucket(
    config.browserBurstCapacity ?? 5,
    config.browserRefillPerSec ?? 1,
  );

  return {
    report(error: DomainError, level: LogLevel, ctx: TelemetryContext) {
      // (3) 폭주 벡터: 윈도우 경계 이벤트(§8.3가 설정한 route 태그)만 버킷에 담긴다.
      const fromBrowserBoundary =
        ctx.route === "window.onerror" || ctx.route === "window.onunhandledrejection";
      if (fromBrowserBoundary && !browserBucket.allow()) {
        return; // throttle에 의해 드롭됨; 에러가 아님 — dead-man's-switch에 먹이지 말 것.
      }

      // @sentry/nextjs v8: 두 번째 인자는 CaptureContext이다; 콜백 형태
      // ((scope: Scope) => Scope)는 이벤트별로 level/fingerprint/tags/contexts/user를
      // 설정하게 해준다. tags/contexts/user/fingerprint는 평범한 options 객체가 아니라
      // scope 위에 존재한다 — 이것이 v8 형태이다.
      Sentry.captureException(error, (scope) => {
        scope.setLevel(toSentryLevel(level));
        // (2) 안정적 그룹화: 스택 프레임별이 아니라 에러 코드별로 하나의 이슈.
        scope.setFingerprint([error.code]);
        scope.setTags({
          code: error.code,
          expected: String(isExpectedCode(error.code as ErrorCode)),
          runtime: ctx.runtime,
          ...(ctx.correlationId ? { correlationId: ctx.correlationId } : {}),
        });
        // (1) details는 클라이언트 DTO를 게이트하는 것과 동일한 allowlist로 편집(redact)됨.
        scope.setContext("app", {
          route: ctx.route ?? null,
          details: gateClientDetails(error.code, error.details) ?? "[gated]",
          droppedByThrottle: fromBrowserBoundary ? browserBucket.droppedSinceLastAllow() : 0,
          // throttled 드롭의 RUNNING 총계 — rate-limited 집계
          // `throttled{droppedCount}`가 라이브 reporter에서 읽힐 수 있게 한다 (G4/G5).
          droppedTotal: browserBucket.droppedTotal(),
        });
        // User: id + role만 — email/PII는 NEVER (beforeSend에서도 방어적으로 스크럽됨).
        scope.setUser(
          ctx.user ? { id: ctx.user.id, ...(ctx.user.role ? { role: ctx.user.role } : {}) } : null,
        );
        return scope;
      });
    },
    // (G5) T1 영향(impact) breadcrumb — 재캡처가 아님. breadcrumb은 이 scope의
    // NEXT 캡처된 이벤트에 첨부되어, 사용자에게 보이는 영향(impact)을
    // correlationId를 통해 에러에 꿰맨다. 카테고리 "error.presented"로 필터링 가능.
    breadcrumb(error: DomainError, surface, ctx: TelemetryContext) {
      Sentry.addBreadcrumb({
        category: "error.presented",
        level: "info",
        data: {
          code: error.code,
          surface,
          correlationId: ctx.correlationId ?? null,
        },
      });
    },
    setUser(user) {
      Sentry.setUser(user ? { id: user.id, ...(user.role ? { role: user.role } : {}) } : null);
    },
    setContext(ctx) {
      if (ctx.correlationId) Sentry.setTag("correlationId", ctx.correlationId);
    },
    droppedTotal: () => browserBucket.droppedTotal(),
  };
};

/**
 * composition root(instrumentation-client.ts / instrumentation.ts)에서 한 번 연결한다.
 * `beforeSend`는 PII 방어의 LAST 라인이다 — 우리 Reporter 바깥에서 Sentry가
 * 자동 캡처하는 것을 포함해 EVERY 이벤트에서 실행된다.
 */
export const sentryBeforeSend = (event: Sentry.ErrorEvent): Sentry.ErrorEvent | null => {
  if (event.user) {
    const { id } = event.user;
    // @sentry/nextjs v8: event.user는 `User | undefined`이다 (`| null`이 아님); undefined로 비운다.
    event.user = id ? { id: String(id) } : undefined; // email/ip_address/username 제거
  }
  if (event.extra) event.extra = scrubDeep(event.extra) as Record<string, unknown>;
  if (event.contexts) event.contexts = scrubDeep(event.contexts) as typeof event.contexts;
  if (event.request?.headers) {
    for (const h of Object.keys(event.request.headers)) {
      if (PII_KEYS.has(h.toLowerCase())) event.request.headers[h] = "[redacted]";
    }
    delete event.request.cookies;
  }
  if (event.message) event.message = scrubString(event.message);
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = scrubString(ex.value);
  }
  return event;
};
```

console reporter는 SDK가 없는 구조화된 서버/개발용 싱크다. 클라이언트 직렬화 모듈이 의도적으로 내부 직렬화기를 export 하지 않으므로, 이 reporter는 내부 직렬화 형태(`message` + 게이트되지 않은 `details` 유지)를 인라인으로 직접 구성한다. r5는 여기에 Sentry와 동일한 `breadcrumb()` 솔기(seam)를 부여한다: `[error.presented]`로 태깅되고 `correlationId`로 키가 지정된 저소음 `console.debug` 라인으로, 사용자에게 보이는 영향(impact)을 캡처된 에러에 꿰맨다 — 재캡처가 아니라 기록이다.

```ts
// error/adapters/console-reporter.ts — 구조화된 서버/개발용 싱크 (SDK 없음).
// (design §5.3)
//
// NOTE (module-map 적응): design은 `./serialize` 모듈에서 `toInternalSerialized`를
// import 했다. canonical module map의 `serialize-client.ts`는 CLIENT 대상 직렬화기만
// export 한다 (`message`를 드롭하고 `details`를 게이트함). 내부 server-log 라인은
// `message`와 게이트되지 않은 `details`를 KEEP 해야 하므로, 내부 직렬화
// 형태는 존재하지 않는 `toInternalSerialized`를 import 하는 대신 여기서 DomainError를
// 기반으로 인라인으로 직접 구성한다.
import type { Reporter } from "../telemetry";
import type { DomainError, SerializedError } from "../app-error";

/** 내부 / server-log DTO: `message`와 게이트되지 않은 `details`를 KEEP 한다. 브라우저에 결코 도달하지 않는다. */
const toInternalSerialized = (error: DomainError): SerializedError => ({
  code: error.code,
  message: error.message,
  details: error.details,
  correlationId: error.correlationId,
});

export const createConsoleReporter = (): Reporter => ({
  report(error, level, ctx) {
    const line = {
      tag: "[error]",
      level,
      ...toInternalSerialized(error), // message + 게이트되지 않은 details 유지 (서버 로그)
      route: ctx.route,
      runtime: ctx.runtime,
    };
    if (level === "fatal" || level === "error") console.error(line);
    else if (level === "warning") console.warn(line);
    else console.info(line);
  },
  // T1 영향(impact) breadcrumb: 저소음 debug 라인, 재캡처가 아님. correlationId로
  // 키가 지정되어 사용자에게 보이는 영향(impact)이 캡처된 에러에 꿰매진다.
  breadcrumb(error, surface, ctx) {
    console.debug({
      tag: "[error.presented]",
      code: error.code,
      surface,
      correlationId: ctx.correlationId,
      route: ctx.route,
      runtime: ctx.runtime,
    });
  },
  setUser() {}, // console reporter는 stateless
  setContext() {},
});
```

composite는 dead-man-switch(데드맨 스위치)를 갖춘 가드된 팬아웃(fan-out)이다: 텔레메트리는 앱으로 결코 throw 해서는 안 되지만, 조용히 삼켜진 텔레메트리 실패는 보이지 않는다 — 그래서 싱크별로 실패를 집계하고 rate-limited 최후 수단 라인을 stderr/`console.error`로 방출한다. r5는 새로운 `breadcrumb` 연산을 동일한 가드를 통해 팬아웃하므로, throw 하는 영향(impact) breadcrumb(브레드크럼)도 `report`와 정확히 동일하게 집계된다. `ReporterHealth`는 `totalFailures` 누적 총계(모든 싱크/연산에 걸쳐 결코 리셋되지 않음)를 갖게 되며, 각 최후 수단 라인에 `runningTotal`로 반영된다. 또한 `noopReporter`는 완전한 Reporter로 남도록 `breadcrumb()`를 구현한다.

```ts
// error/adapters/composite.ts  — DEAD-MAN'S-SWITCH로 GUARDED (design §5.3)
// 텔레메트리는 앱으로 결코 throw 해서는 안 되지만, 조용히 삼켜진 텔레메트리 실패는
// 보이지 않는다 — 그래서 싱크별로 실패를 집계하고 RATE-LIMITED 최후 수단 라인을
// stderr(서버) / console.error(클라이언트)로 방출한다.
import type { Reporter } from "../telemetry";

export interface ReporterHealth {
  readonly failures: ReadonlyMap<string, number>;
  /** 모든 싱크/연산에 걸쳐 삼켜진 실패의 running 총계 (결코 리셋되지 않음). */
  readonly totalFailures: number;
  readonly lastFailureAt?: number;
}

const emitLastResort = (line: Record<string, unknown>): void => {
  const text = `[telemetry-dead-mans-switch] ${JSON.stringify(line)}\n`;
  const proc = (globalThis as { process?: { stderr?: { write(s: string): void } } }).process;
  if (proc?.stderr?.write) proc.stderr.write(text);
  else console.error(text);
};

export interface CompositeReporterOptions {
  /** 마지막 수단(last-resort) 방출 사이의 최소 ms (데드맨 스위치 자체가 폭주하지 않도록). 기본값 5000 */
  alertThrottleMs?: number;
  now?: () => number;
}

/** 실패 집계에 사용되는 안정적인 라벨과 짝지어진 Reporter. */
export interface LabeledReporter {
  label: string;
  reporter: Reporter;
}

export interface GuardedCompositeReporter extends Reporter {
  /** 검사 가능한 health — /health 라우트에서 노출하거나 테스트에서 단언한다. */
  health(): ReporterHealth;
}

export const guardedCompositeReporter = (
  sinks: ReadonlyArray<LabeledReporter>,
  options: CompositeReporterOptions = {},
): GuardedCompositeReporter => {
  const throttleMs = options.alertThrottleMs ?? 5000;
  const now = options.now ?? (() => Date.now());
  const failures = new Map<string, number>();
  let totalFailures = 0; // 모든 sink/op에 걸친 누적 합계; 결코 리셋되지 않는다.
  let lastFailureAt: number | undefined;
  let lastAlertAt = 0;

  const guard = (label: string, op: string, fn: () => void): void => {
    try {
      fn();
    } catch (cause) {
      const n = (failures.get(label) ?? 0) + 1;
      failures.set(label, n);
      totalFailures += 1;
      lastFailureAt = now();
      if (lastFailureAt - lastAlertAt >= throttleMs) {
        lastAlertAt = lastFailureAt;
        emitLastResort({
          sink: label,
          op,
          totalFailures: n,
          runningTotal: totalFailures,
          message: cause instanceof Error ? cause.message : String(cause),
          at: new Date(lastFailureAt).toISOString(),
        });
      }
    }
  };

  return {
    report: (e, l, c) => sinks.forEach((s) => guard(s.label, "report", () => s.reporter.report(e, l, c))),
    breadcrumb: (e, surface, c) =>
      sinks.forEach((s) => guard(s.label, "breadcrumb", () => s.reporter.breadcrumb(e, surface, c))),
    setUser: (u) => sinks.forEach((s) => guard(s.label, "setUser", () => s.reporter.setUser(u))),
    setContext: (c) => sinks.forEach((s) => guard(s.label, "setContext", () => s.reporter.setContext(c))),
    health: () => ({ failures: new Map(failures), totalFailures, lastFailureAt }),
  };
};

/** "Optional" = 모니터링이 비활성화될 때 이것을 합성해 넣는다 (예: 테스트 / 로컬에서). */
export const noopReporter: Reporter = {
  report() {},
  breadcrumb() {},
  setUser() {},
  setContext() {},
};

/**
 * 레거시 가변 인자 composite (라벨 없음). health 집계가 필요 없는 호출 지점을 위해
 * 유지한다; 프로덕션에서는 guardedCompositeReporter([{label,reporter}, …])를 선호하라.
 */
const guard = (fn: () => void): void => {
  try {
    fn();
  } catch {
    /* 텔레메트리는 결코 throw해서는 안 된다 */
  }
};

export const compositeReporter = (...r: Reporter[]): Reporter => ({
  report: (e, l, c) => r.forEach((x) => guard(() => x.report(e, l, c))),
  breadcrumb: (e, surface, c) => r.forEach((x) => guard(() => x.breadcrumb(e, surface, c))),
  setUser: (u) => r.forEach((x) => guard(() => x.setUser(u))),
  setContext: (c) => r.forEach((x) => guard(() => x.setContext(c))),
});
```

```ts
// error/adapters/composite-imports.ts  (re-export barrel)
export { compositeReporter, guardedCompositeReporter, noopReporter } from "./composite";
export { createSentryReporter, sentryBeforeSend } from "./sentry-reporter";
export { createConsoleReporter } from "./console-reporter";
```

pager notifier는 페이저 벤더가 존재한다는 사실을 아는 유일한 파일이다 (PagerDuty / Opsgenie / Slack은 하나의 webhook 형태 뒤에 놓인 세 가지 `PagerTransport` 구현이다). `notify()`는 fire-and-forget이므로 `handleError`는 논블로킹을 유지하고, 전송 실패는 삼켜진 뒤 콘솔에 자체 보고되며, r5는 두 가지 강화를 추가한다. 즉, 아웃바운드 webhook 호출은 `AbortSignal.timeout(5000)`으로 한계가 지어져 멈춰버린 webhook이 매달린 요청을 누출하지 못하게 하고, 인프로세스 **`dedupKey`별 억제기(suppressor)**(G7)는 동일 사건의 폭주를 — `code + route`를 키로 삼아 — 윈도우당 한 번의 페이지로 접어 넣어 온콜(그리고 Slack webhook)이 새로고침/재시도 폭주에 휩쓸리지 않도록 한다.

```ts
// error/adapters/pager-notifier.ts  (design §5.1)
// 페이저 벤더가 존재한다는 사실을 아는 유일한 파일. 교체 가능: PagerDuty / Opsgenie
// / Slack은 하나의 webhook 형태 뒤에 놓인 세 가지 PagerTransport 구현이다.
import "server-only"; // 페이징은 서버 런타임에 속한다; 결코 클라이언트로 번들되지 않는다
import type { Notifier } from "../notifier";
import type { DomainError } from "../app-error";
import type { Severity } from "../severity";
import type { TelemetryContext } from "../telemetry";

export interface PageEvent {
  readonly title: string;
  readonly severity: Severity;
  readonly code: string;
  readonly correlationId?: string;
  readonly route?: string;
  readonly runtime: TelemetryContext["runtime"];
  readonly dedupKey: string; // 동일 code의 폭주를 하나의 사건으로 접어 넣는다
}

/** PagerDuty Events API v2, Opsgenie, 또는 Slack webhook을 가리키도록 이것을 교체하라. */
export interface PagerTransport {
  send(event: PageEvent): Promise<void>;
}

const toPageEvent = (
  error: DomainError,
  severity: Severity,
  ctx: TelemetryContext,
): PageEvent => ({
  title: `[${severity.toUpperCase()}] ${error.code}: ${error.message}`,
  severity,
  code: error.code,
  correlationId: ctx.correlationId,
  route: ctx.route,
  runtime: ctx.runtime,
  // 재시도/새로고침 루프가 온콜을 스팸하지 않도록 code+route로 dedup한다.
  dedupKey: `${error.code}:${ctx.route ?? "unknown"}`,
});

/**
 * dedupKey별 억제기(G7): 윈도우당 dedupKey 하나에 한 번의 페이지. 키별 시간 기반 리필
 * 토큰 버킷 — 어떤 키의 FIRST 페이지는 통과하고(용량 1), 동일 키에 대한 후속
 * 페이지는 윈도우가 경과할 때까지 억제되므로, Slack webhook이 동일 사건의
 * 새로고침/재시도 폭주에 휩쓸리지 않는다.
 */
interface DedupSuppressor {
  /** true = 이 페이지를 허용; false = 억제 (윈도우 내에서 이미 페이지됨). */
  allow(dedupKey: string): boolean;
}
const makeDedupSuppressor = (
  windowMs: number,
  now: () => number = () => Date.now(),
): DedupSuppressor => {
  const lastPagedAt = new Map<string, number>();
  return {
    allow(dedupKey) {
      const t = now();
      const prev = lastPagedAt.get(dedupKey);
      if (prev !== undefined && t - prev < windowMs) return false;
      lastPagedAt.set(dedupKey, t);
      return true;
    },
  };
};

export interface PagerNotifierOptions {
  /** 동일 dedupKey에 대한 페이지 사이의 최소 ms. 기본값 60_000 (사건당 분당 한 페이지). */
  dedupWindowMs?: number;
  now?: () => number;
}

/**
 * 기본 페이저 Notifier. notify()는 동기 반환(fire-and-forget)이다: 비동기 send를
 * 시작하되 결코 await하지 않으므로 handleError는 논블로킹을 유지한다. Transport
 * 실패는 삼켜진다(그리고 콘솔에 자체 보고된다) — 알림은 결코 throw해서는 안 된다.
 * (G7) 인프로세스 dedupKey별 억제기가 동일 사건의 폭주를 윈도우당 한 페이지로
 * 접어 넣어 Slack webhook이 휩쓸리지 않도록 한다.
 */
export const createPagerNotifier = (
  transport: PagerTransport,
  options: PagerNotifierOptions = {},
): Notifier => {
  const suppressor = makeDedupSuppressor(options.dedupWindowMs ?? 60_000, options.now);
  return {
    notify(error, severity, ctx) {
      const event = toPageEvent(error, severity, ctx);
      if (!suppressor.allow(event.dedupKey)) return; // 이번 윈도우에 이 사건을 이미 페이지함.
      void transport.send(event).catch((cause: unknown) => {
        console.error({ tag: "[pager-failed]", code: error.code, cause });
      });
    },
  };
};

/** 참조 transport: 일반적인 incoming-webhook 어댑터 (Slack 형태). */
export const webhookPagerTransport = (webhookUrl: string): PagerTransport => ({
  async send(event) {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // 멈춰버린 webhook이 매달린 요청을 누출하지 못하도록 아웃바운드 호출에 한계를 둔다.
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({
        text: event.title,
        // PagerDuty Events API v2 교체: { routing_key, dedup_key: event.dedupKey,
        //   event_action: "trigger", payload: { summary: event.title, severity: event.severity,
        //   source: event.route ?? "app", custom_details: { code, correlationId, runtime } } }
        dedup_key: event.dedupKey,
        severity: event.severity,
        custom_details: {
          code: event.code,
          correlationId: event.correlationId,
          route: event.route,
          runtime: event.runtime,
        },
      }),
    });
  },
});
```

Presenter는 클라이언트 전용 UX 싱크이며 — 실제 구현은 sonner SDK를 import하는 유일한 파일인 sonner 어댑터다. 이는 `handleError`의 `present "toast"/"alert"` 단계(§5.1) 뒤에 놓인 구체적 싱크다. 파이프라인은 이미 Presenter가 아닌 surface(`"inline"`, `"silent"`, redirect/refresh)를 걸러내지만, 어댑터는 그럼에도 방어적으로, `PresentAction`이 `"toast"`나 `"alert"`가 아니면 일찍 반환한다. 카피(copy)는 `resolveErrorMessage`를 통해 해석되므로(호스트 번역기 → 함께 위치한(co-located) 폴백 → 일반 문구), Presenter는 결코 원시 `userMessageKey`를 렌더링하지 않으며 — `RATE_LIMITED`의 경우 공개된 `retryAfterMs` 세부정보로부터 `{seconds}` 카운트다운을 보간한다(§5.2에서 이제 allowlist가 경계를 넘도록 허용하는 바로 그 값이다). 토스트는 토스트 `id`를 `error.code`로 설정하여 중복을 제거하므로, 동일 code의 폭주는 쌓이는 대신 단일하게 갱신되는 하나의 토스트로 접어 넣어진다.

```ts
// error/adapters/sonner-presenter.ts  — sonner SDK를 import하는 유일한 파일.
// (design §5 — Presenter sink) 클라이언트 전용 UX 싱크: DomainError를 토스트로 변환한다.
//
// 카피는 resolveErrorMessage를 통해 해석되므로(호스트 번역기 → 함께 위치한 폴백 →
// 일반 문구), Presenter는 결코 원시 i18n 키를 렌더링하지 않는다. RATE_LIMITED는
// 공개된 retryAfterMs 세부정보로부터 `{seconds}` 카운트다운을 보간한다 (G2 / G6).
//
// 중복 제거: 토스트 `id`가 error.code이므로, 동일 code의 폭주는 쌓이는 대신
// 단일하게 갱신되는 하나의 토스트로 접어 넣어진다. 여기서는 "toast"/"alert"만 의미가 있다;
// handleError 파이프라인이 이미 Presenter가 아닌 surface를 걸러내지만, 그럼에도 방어한다.
import { toast } from "sonner";
import type { Presenter } from "../telemetry";
import { isDomainError, type DomainError } from "../app-error";
import { resolveErrorMessage, type Translator } from "../translator";

/**
 * `any` 캐스트 없이 RATE_LIMITED 오류로부터 공개된 Retry-After 값(ms)을 읽는다.
 * 일반 DomainError의 `error.details`는 전체 ErrorDetailsMap 유니온(null 포함)이므로,
 * `.retryAfterMs`에 직접 도달할 수 없다. isDomainError(e, code) 가드는
 * 전체 인스턴스를 DomainError<"RATE_LIMITED">로 좁혀, details를
 * `{ retryAfterMs?: number } | null`로 접어 넣는다 — strict + noUncheckedIndexedAccess 깔끔함.
 */
const retryAfterMsOf = (error: DomainError): number | undefined => {
  if (!isDomainError(error, "RATE_LIMITED")) return undefined;
  return error.details?.retryAfterMs;
};

export const createSonnerPresenter = (translator?: Translator | null): Presenter => ({
  present(error, action) {
    // 방어적: toast/alert만 사용자 대면 토스트 surface에 도달한다.
    if (action !== "toast" && action !== "alert") return;

    const retryAfterMs = retryAfterMsOf(error);
    const vars =
      retryAfterMs !== undefined ? { seconds: Math.ceil(retryAfterMs / 1000) } : undefined;
    const message = resolveErrorMessage(error.userMessageKey, translator, vars);

    // code로 중복 제거: code당 하나의 토스트, 반복 시 제자리에서 갱신.
    const options = { id: error.code } as const;
    if (action === "alert") toast.error(message, options);
    else toast(message, options);
  },
});
```

**correlation ID + 사용자 컨텍스트가 어떻게 붙는가.** 이들은 `TelemetryContext`에 존재하며, 모든 `handleError` 호출에 엮여 들어간다(§8/§9). 클라이언트에서는 `initHandleError`가 로그인/시작 시 한 번 `reporter.setUser` / `reporter.setContext({ correlationId })`를 호출한다. 서버에서는 요청별 핸들러가 요청 헤더로부터 새로운 `TelemetryContext`를 구성한다(§7.1a) — 요청 간 공유되는 가변 상태는 없다. `TelemetryContext`는 또한 OpenTelemetry 이음새(seam)로서 선택적 `traceId?`를 함께 운반하며, 현재는 사용되지 않고, 포착된 fault, 영향(impact) breadcrumb(브레드크럼), 그리고 다운스트림 span들을 하나의 trace로 꿰매기 위해 예약되어 있다.
### 5.4 통합 프로세서 — `createHandleError`

`handleError`는 일곱 개의 정책 필드 전부를 공유 `resolvePolicy()`(§3.3)를 통해 주입된(injected) `deps.registry`에서 해석한다 — 게터(getter)가 읽는 것과 동일한 소스이며, 활성 레지스트리가 컴포지션 루트에서 한 번 바인딩되고 나면 곧 `deps.registry`이기 때문이다. 호출별 `present`/`log`(및 선택적 `severity`) 오버라이드를 접어 넣은 뒤 네 단계를 순서대로 실행한다: (1) 로그 정책이 `"none"`이 아닐 때 Sentry/console로 **report**, (2) 알림 게이트로 무조건 **notify**, (3) **present** — 단 Presenter가 처리 가능한 두 표면 `"toast"`/`"alert"`에 대해서만, 그리고 (4) `present !== "silent"`일 때마다 **영향(impact) breadcrumb(브레드크럼)** 발행. 반환값은 **`ResolvedAppError { error, code, policy }`**이다. `notify()` 호출은 `report()` **뒤**에 위치하여(온콜 엔진이 상관 관계가 맺어진 Sentry 이벤트를 대기 상태로 두도록) `present()` **앞**에 오며, 호출 지점에서는 **무조건적**이다 — 억제(suppression)는 `handleError` 내부의 `if`가 아니라 (`policyGatedNotifier`를 통한) `AlertPolicy`가 소유한다. `noopNotifier`는 호출 지점 분기 없이 싱크 전체를 선택적으로 만든다.

영향 breadcrumb(브레드크럼)는 핵심적인 r5 변경이다. 결함(fault)은 **한 번 캡처되고**(1단계, `ctx.correlationId`로 키가 매겨진 `report()` 호출), **사용자에게 보이는 영향(impact)**은 동일한 correlation id 위에 breadcrumb(브레드크럼)(`reporter.breadcrumb`)로 **별도로** 기록되며, 이는 **`log`와 무관하다**. 이로써 과거의 "중복 로깅 금지" 혼동이 해소된다: 이전에는 "두 번 로깅하지 말라"가 결함을 기록할지 사용자가 본 것을 기록할지 사이의 선택을 강요했다. 이제 둘은 하나의 타임라인 위에 놓인 두 개의 별개 사실이다 — 먼저 결함, 그다음 그것이 어떻게 표면화되었는지(toast, alert, inline, page, …)를 기록하는 breadcrumb(브레드크럼). breadcrumb(브레드크럼)는 액션이 진정으로 `"silent"`일 때만 건너뛰어지며(예: `REQUEST_ABORTED`), 그 경우 기록할 사용자 영향이 없다. 비즈니스 인라인 오류(`"inline"`)는 Presenter에 결코 도달하지 않더라도 breadcrumb(브레드크럼)를 발행한다.

```ts
// error/handle-error.ts  — 모든 정책을 주입된 레지스트리에서 해석한다; ResolvedAppError를 반환한다.
import { DomainError, resolvePolicy, type ResolvedAppError } from "./app-error";
import { normalizeToDomainError } from "./normalize";
import type { HandleErrorDeps } from "./types";
import type { TelemetryContext } from "./telemetry";
import type { PresentAction, LogLevel } from "./policy";
import type { Severity } from "./severity";

export interface HandleErrorOptions {
  present?: PresentAction;
  log?: LogLevel;
  /** 이 호출에 한해 해석된 severity를 오버라이드한다 (드묾; 예: 알려진 소음 코드를 강등). */
  severity?: Severity;
  fallbackMessage?: string;
  ctx?: Partial<TelemetryContext>;
}

export const createHandleError =
  (deps: HandleErrorDeps, baseCtx: TelemetryContext) =>
  (input: unknown, options: HandleErrorOptions = {}): ResolvedAppError => {
    const error = normalizeToDomainError(input, options.fallbackMessage, baseCtx.correlationId);
    // 일곱 개의 정책 필드 전부를 주입된 레지스트리에서 해석하며, 인스턴스
    // 오버라이드를 존중한다. 게터가 읽는 것과 동일한 소스 (한 번 바인딩되면 활성 레지스트리가 곧 deps.registry).
    const base = resolvePolicy(deps.registry, error.code, {
      severity: (error as DomainError).severity,
      retryable: (error as DomainError).retryable,
    });
    const present: PresentAction = options.present ?? base.present; // 호출별 오버라이드가 우선
    const log: LogLevel = options.log ?? base.log;
    // severity는 Sentry 레벨(report 경유)과 알림 게이트(notify 경유) 둘 다를 구동한다.
    // options.severity가 우선; 그렇지 않으면 인스턴스/레지스트리에서 해석된 severity.
    const severity: Severity = options.severity ?? base.severity;
    const ctx: TelemetryContext = { ...baseCtx, ...options.ctx };

    // 1. Sentry / console — 로그 정책이 요구할 때만.
    if (log !== "none") deps.reporter.report(error, log, ctx);
    // 2. 알림 게이트 (임계값 미만에서는 no-op).
    deps.notifier.notify(error, severity, ctx);
    // 3. Presenter가 처리 가능한 표면에 대해서만 PRESENTER. "redirect"/"page"는
    //    Presenter가 아니라 클라이언트 useErrorHandler가 에스컬레이션한다; "inline"/"silent"는
    //    여기서 아무것도 하지 않는다. "toast"/"alert"만 present()에 도달한다.
    if (present === "toast" || present === "alert") deps.presenter.present(error, present, ctx);
    // 4. T1 영향 BREADCRUMB: 재캡처 없이 사용자에게 보이는 영향을 기록하며,
    //    ctx.correlationId로 키가 매겨지고, log와 무관하다. 진정으로 silent일 때만 건너뛴다.
    if (present !== "silent") deps.reporter.breadcrumb(error, present, ctx);

    // 핵심: 호출자는 result.policy를 기준으로 컨텍스트 특화 UI("page" 에스컬레이션 포함)를 구동한다.
    return { error, code: error.code, policy: { ...base, severity, present, log } };
  };
```

> **`ResolvedAppError` 대 인스턴스 게터.** `result.policy.present`/`.log`는 이미 호출별 `HandleErrorOptions` 오버라이드를 접어 넣은 값이다; 인스턴스 게터 `err.present`/`err.log`는 레지스트리 기준선만 반영한다. *유효한* 표현(presentation)을 원하는 호출자는 `result.error.present`가 아니라 `result.policy.present`를 읽어야 한다. §8의 클라이언트 `handleError` 재내보내기(re-export)는 동일한 `ResolvedAppError`를 반환한다; `AppError`를 구조 분해하던 레거시 호출 지점은 `result.error`를 읽고, `useErrorHandler`(§8.2)는 `result.policy.present`로 분기한다.

**Presenter 어댑터(`page` 분기를 명시화).** toast 라이브러리는 전체 페이지 라우트를 마운트할 수 없으므로, `page`(및 `redirect`)는 `handleError`에 의해 Presenter로 결코 디스패치되지 않는다 — 3단계는 `"toast"`/`"alert"`에 대해 엄격히 게이팅한다. 전체 페이지 전달은 `useErrorHandler` / `raise()`(§8.2 / §7.2)가 소유하는 *에스컬레이션*이다. Presenter는 직접 호출이 오작동할 수 없도록 나머지 액션들을 여전히 명시적 no-op으로 방어한다.

```ts
// error/adapters/presenter.ts
import type { Presenter as PresenterIface } from "../telemetry";
import { toast } from "sonner";

export const createSonnerPresenter = (): PresenterIface => ({
  present(error, action, _ctx) {
    switch (action) {
      case "toast": toast.error(error.message); return;
      case "alert": window.alert(error.message); return;
      case "redirect": // 내비게이션은 Presenter가 아니라 useErrorHandler가 수행한다
      case "page":     // 전체 페이지 에스컬레이션은 useErrorHandler / raise()가 수행한다
      case "inline":   // 비즈니스 인라인 오류 — Presenter가 아니라 폼/필드가 렌더링한다
      case "silent":   return;
    }
  },
});

/** 서버 Presenter: 서버에는 UI가 없다. 항상 no-op이다. */
export const serverPresenter: PresenterIface = { present() {} };
```

**컴포지션 루트 — 두 런타임 모두.** `serverDeps`(서버의 싱크 선택)는 §7.1a에서 배선되며; 클라이언트의 `buildClientDeps`/`buildServerDeps`는 §8.1에서 배선된다. 참고를 위한 배선의 형태:

```ts
// error/build-deps.ts  (컴포지션 루트 — 두 런타임의 배선을 보여준다)
import { DEFAULT_ERROR_REGISTRY } from "./registry";
import type { HandleErrorDeps } from "./types";
import { guardedCompositeReporter, createSentryReporter, createConsoleReporter } from "./adapters/composite-imports";
import { createSonnerPresenter, serverPresenter } from "./adapters/presenter";
import { noopNotifier, policyGatedNotifier } from "./notifier";
import { thresholdAlertPolicy } from "./alert-policy";

/** 서버 deps: 실제 pager, fatal 이상으로 게이팅됨. */
export const buildServerDeps = (): HandleErrorDeps => {
  // createPagerNotifier + webhookPagerTransport은 서버 전용; 지연 import하여
  // 클라이언트 번들링 중 "server-only" 가드가 결코 걸리지 않도록 한다.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createPagerNotifier, webhookPagerTransport } = require("./adapters/pager-notifier") as typeof import("./adapters/pager-notifier");
  const url = process.env.PAGER_WEBHOOK_URL;
  const notifier = url
    ? policyGatedNotifier(
        thresholdAlertPolicy({ threshold: "fatal", suppressRuntimes: ["client"] }),
        createPagerNotifier(webhookPagerTransport(url)),
      )
    : noopNotifier; // 구성된 webhook 없음 (로컬/프리뷰/테스트) → 절대 호출(page)하지 않음
  return {
    registry: DEFAULT_ERROR_REGISTRY,
    reporter: guardedCompositeReporter([
      { label: "sentry", reporter: createSentryReporter() },
      { label: "console", reporter: createConsoleReporter() },
    ]),
    presenter: serverPresenter,
    notifier,
  };
};

/** 클라이언트 deps: pager 없음. 클라이언트 오류는 결코 직접 호출(page)하지 않는다 — Sentry 알림 규칙이
 *  대신 서버에 상관된 이벤트를 기준으로 호출(page)한다. noopNotifier가 싱크를 선택적으로 유지한다. */
export const buildClientDeps = (): HandleErrorDeps => ({
  registry: DEFAULT_ERROR_REGISTRY,
  reporter: createSentryReporter(),
  presenter: createSonnerPresenter(),
  notifier: noopNotifier,
});
```

- **서버**: `createHandleError(deps, ctx)`는 React `cache()`(§7.1a)를 통해 **요청별**로 호출된다 — 그렇지 않으면 Node 모듈 캐싱이 요청 간에 `ctx`/사용자를 누출시킨다. `serverPresenter`는 no-op이며; 서버 호출은 `present:"silent"`(또는 응답 본문에 표면화되는 비즈니스 검증의 경우 `"inline"`)를 전달한다. 요청별 작업은 활성 레지스트리가 요청 범위가 되도록 `runWithErrorRegistry(deps.registry, …)`로 감싸진다.
- **클라이언트**: `initHandleError(deps)`는 시작 시 싱글턴을 한 번 빌드하고, `setActiveErrorRegistry(deps.registry)`를 호출하며, 전역 `handleError` 재내보내기(re-export)가 읽는 모듈 범위 슬롯에 핸들러를 저장한다.


---
## 6. Next.js 경계로의 결선

### 6.1 `{ error, reset }` / `unstable_retry` 계약 — 버전 재조정

본 시리즈(v16.1 이하에서 작성)는 `{ error, reset }`를 사용한다. 현행 Next 문서에 따르면 `unstable_retry()`(재페치 **그리고** 재렌더)가 `reset()`(재렌더만) 대신 승격되었다. **재조정:** 양쪽을 모두 지원한다. `reset`은 여전히 동작하지만, 대부분의 경계 실패는 데이터 실패이고 순수 재렌더는 다시 throw할 뿐이므로 `unstable_retry`가 선호된다. 공유 컴포넌트가 그 차이를 추상화하므로, `unstable_` API가 사용 중인 Next 버전에서 이름이 바뀌더라도 한 파일만 변경하면 된다. **r3:** 이전에 정의되지 않았던 `t(...)`는 이제 i18n 계층(§6.3)을 통해 해소된다. `error.tsx`는 컨텍스트 번역기를 사용하고, `global-error.tsx`는 프로바이더 없는 폴백 번역기(`minimal` 경로)를 사용한다. **r5 (G11):** 폴백의 재시도 버튼은 과거에 죽은 컨트롤이었다 — `reset`만 사용 가능했을 때 *동일한* 낡은 RSC 페이로드에 대해 경계를 재렌더하고 즉시 다시 throw했으므로, 사용자에게는 "재시도"한 것처럼 보였지만 실제로는 아무것도 재페치되지 않았다. r5는 이를 수정한다: reset 전용 경로는 이제 `reset()`(경계 재렌더) *이전에* `router.refresh()`(서버 데이터 재페치)를 호출하고, 재시도는 `useTransition` 안에서 실행되어 버튼이 대기/비활성 상태를 표시하며, 어포던스는 **재시도 불가능한 코드에 대해서는 차단되고**(`retryable`이 false인 `DomainError`는 버튼을 제공하지 않는다), `role="alert"` 영역은 보조기술/키보드 사용자를 위해 마운트 시 포커스되며, report 효과는 `try/catch`로 감싸져 클라이언트 싱글톤이 한 번도 초기화되지 않았더라도 `global-error.tsx`가 결코 크래시하지 않는다.

```tsx
// components/ErrorFallback.tsx
"use client";

// components/ErrorFallback.tsx — 공유 렌더링 경계 폴백 UI (§6.1).
// v16.1의 `{ error, reset }` 계약을 승격된 `unstable_retry`와 재조정한다:
// 양쪽을 모두 지원한다. `unstable_retry`(재페치 + 재렌더)가 `reset`
// (재렌더만)보다 선호된다. `reset`만 있을 때는 RSC
// 페이로드가 Next 15에서 재페치되도록 `router.refresh()`도 호출한다(reset 단독은 경계만 재렌더한다). 만약
// 둘 다 제공되지 않으면 하드 리로드로 격하한다. `unstable_` API는
// Next 버전에 따라 이름이 바뀔 수 있으므로, 그 차이를 여기서 추상화하여 이름 변경이
// 한 파일 변경으로 끝나게 한다 — 그리고 `unstable_retry`는 우리 자신의 선택적 prop으로 타입 지정된다(`next`에서
// import하지 않으며), 이 런타임의 surface와 일치한다.
//
// G11: (a) role="alert" 컨테이너는 스크린리더/키보드 사용자를 위해 마운트 시 포커스된다;
// (b) 재시도는 useTransition 안에서 실행되어 버튼이 대기/비활성
// 상태를 표시한다; (c) reset 전용은 router.refresh()+reset()로 재페치한다; (d) 재시도 어포던스는
// 재시도 불가능한 코드에 대해 숨겨진다; (e) report 효과는 try/catch로 감싸져
// 클라이언트 싱글톤이 초기화되지 않았더라도 global-error.tsx가 결코 throw하지 않는다.

import { useContext, useEffect, useRef, useTransition } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { resolveErrorMessage } from "@/error/translator";
import { handleError } from "@/error/handler";
import { isDomainError } from "@/error/app-error";

type RetryProp = { unstable_retry?: () => void; reset?: () => void };

export function ErrorFallback({
  error,
  unstable_retry,
  reset,
  minimal = false,
}: { error: Error & { digest?: string } } & RetryProp & { minimal?: boolean }) {
  // useRouter()를 거치지 않고 App Router 컨텍스트를 직접 읽는다: useRouter()는
  // AppRouterContext가 마운트되지 않았을 때 THROW한다(예: 루트 레이아웃을 대체하는
  // global-error.tsx, 그리고 단위 렌더). 그곳에서 컨텍스트는 null이다 — 우리는
  // RSC 재페치를 no-op으로 격하하고 reset()을 통해 여전히 재렌더한다.
  const router = useContext(AppRouterContext);
  const alertRef = useRef<HTMLDivElement>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    // (e) global-error.tsx는 루트 레이아웃(그리고 클라이언트 싱글톤
    // init)이 우회될 때 이것을 렌더한다; initHandleError()가 한 번도 실행되지 않았다면 handleError()가 throw한다. 이를 삼켜서
    // 폴백이 렌더 크래시로 연쇄되는 대신 여전히 실제 카피를 렌더하게 한다.
    try {
      // log:"none" → 이미 서버/네트워크 경계에서 보고됨(중복 없음).
      // `route`는 `ctx`를 통해 호출별 TelemetryContext에 접힌다.
      handleError(error, { log: "none", ctx: { route: location.pathname } });
    } catch {
      // 의도적으로 무음 — 경계의 역할은 RENDER이지, 재보고가 아니다.
    }
  }, [error]);

  // (a) 마운트 시 포커스를 alert 영역으로 옮겨 AT가 이를 알리고 키보드
  // 사용자가 복구 어포던스에 안착하게 한다.
  useEffect(() => {
    alertRef.current?.focus();
  }, []);

  // (c) 재시도 소스 재조정. unstable_retry(재페치+재렌더)가 이긴다. 그렇지 않으면
  // reset 전용: RSC 페이로드를 새로고침한 THEN 경계를 재렌더한다. router는 App Router
  // 컨텍스트 밖(예: 단위 렌더)에서 null일 수 있다 — optional-chain으로 reset()이 여전히
  // 실행되게 한다. 최후의 수단: 하드 리로드.
  const retry = () => {
    if (unstable_retry) {
      unstable_retry();
      return;
    }
    if (reset) {
      router?.refresh(); // 서버 데이터 재페치 (Next 15: reset() 단독은 재렌더만)
      reset();
      return;
    }
    location.reload();
  };

  // (b) 버튼이 대기/비활성 상태를 반영할 수 있도록 재시도를 트랜지션 안에서 실행한다.
  const onRetry = () => startTransition(retry);

  // RSC 프로덕션 에러의 경우 raw `error.message`는 플레이스홀더다. 레지스트리
  // userMessageKey를 카피로 해소하는 것을 선호한다; 그렇지 않으면 정적 로컬라이즈된 라인. 
  // 프로바이더 없는 `resolveErrorMessage`는 raw 키를 결코 반환하지 않고 결코 throw하지 않으므로,
  // 일반(`error.tsx`) 경로와 `minimal`(`global-error.tsx`) 경로 모두 어떤 React 컨텍스트 번역기 없이도
  // 실제 카피를 렌더한다.
  const title = isDomainError(error)
    ? resolveErrorMessage(error.userMessageKey)
    : resolveErrorMessage("error.unknown");

  // (d) 재시도가 의미 있을 때만 재시도를 제공한다. DomainError는
  // 활성 레지스트리에서 해소된 `retryable`을 담는다; non-DomainError(raw 렌더 크래시)에는
  // 항상 어포던스가 제공된다(reset/reload가 일시적 렌더 결함을 복구할 수 있다).
  const canRetry = isDomainError(error) ? error.retryable : true;

  return (
    <div role="alert" ref={alertRef} tabIndex={-1}>
      <h2>{title}</h2>
      {!minimal && <p>잠시 후 다시 시도해주세요.</p>}
      {error.digest && (
        <p style={{ opacity: 0.5, fontSize: 12 }}>ref: {error.digest}</p>
      )}
      {canRetry && (
        <button onClick={onRetry} disabled={isPending}>
          다시 시도
        </button>
      )}
    </div>
  );
}
```

```tsx
// app/error.tsx
"use client";

// app/error.tsx — 세그먼트별 렌더링 경계 (렌더링 경계).
// Next는 이것을 { error, reset }로 호출한다; 이 런타임은 승격된
// `unstable_retry`도 전달한다. `unstable_retry`를 우리 자신의 선택적 prop으로 타입 지정하고(`next`에서
// import하지 않는다) 모든 것을 공유 ErrorFallback으로 전달하며, 그것이
// 재시도 소스 재조정(unstable_retry ?? reset ?? reload)을 소유한다.

import { ErrorFallback } from "@/components/ErrorFallback";

export default function Error(props: {
  error: Error & { digest?: string };
  reset: () => void;
  unstable_retry?: () => void;
}) {
  return <ErrorFallback {...props} />;
}
```

```tsx
// app/global-error.tsx
"use client";

// app/global-error.tsx — 루트 경계; 루트 레이아웃을 REPLACE하므로
// 자기 자신의 <html><body>를 소유하고 어떤 프로바이더도 마운트하지 않는다(§6.1). 이는 ErrorFallback을
// `minimal`로 렌더하며, 이는 프로바이더 없는 해소 경로를 강제한다: chrome 문자열에는
// 하드코딩된 로컬라이즈 리터럴, 제목에는 `resolveErrorMessage`(같은 위치에 둔
// 폴백 맵, 컨텍스트 번역기 없음). global-error는
// `metadata`를 export할 수 없다(클라이언트 컴포넌트다); 필요하면 React <title>을 사용한다.

import { ErrorFallback } from "@/components/ErrorFallback";

export default function GlobalError(props: {
  error: Error & { digest?: string };
  reset: () => void;
  unstable_retry?: () => void;
}) {
  return (
    <html lang="ko">
      <body>
        <ErrorFallback {...props} minimal />
      </body>
    </html>
  );
}
```

준수된 핵심 제약: `error.tsx`는 자기 세그먼트의 `layout.tsx` 에러를 잡을 수 없다 → 루트 레이아웃 결함에는 `global-error.tsx`가 필수다. `global-error`는 `metadata`를 export할 수 없다(클라이언트 컴포넌트다) → 필요하면 React `<title>`을 사용한다. 양쪽 모두 `handleError`를 `useEffect` 안에서 호출하며, 렌더링 도중에는 결코 호출하지 않는다. 경계는 `log: "none"`을 전달하므로 `handleError`는 그 결함을 재보고하지 않는다(서버/네트워크 경계에서 이미 한 번 포착되었다) — 그러나 폴백 자체가 사용자에게 보이는 영향(impact)이므로, 핸들러는 `silent`가 아닌 모든 present에 대해 여전히 자신의 **영향(impact) breadcrumb(브레드크럼)**(`reporter.breadcrumb`)을 방출한다: 결함은 한 번 포착되고 사용자 영향은 별도로 기록되며, 이는 과거의 중복 로깅 금지 혼동을 해소하는 바로 그 분리(§4)다.

### 6.2 프로덕션에서 제거된 메시지 + digest 상관

프로덕션의 RSC 에러는 **일반화된** `message`와 `digest`를 달고 도착한다. 폴백 UI는 그러한 에러에 대해 `error.message`를 표시해서는 **안 된다**(이는 플레이스홀더다) — 대신 정적 로컬라이즈된 문자열(i18n 계층을 통해 해소, §6.3)을 표시하고 `digest`를 지원 참조로 노출한다. 진짜 진단 정보는 서버 측에 있다: 서버 경계가 동일한 `correlationId`로 키잉된 원본 에러를 로깅했고, Sentry가 전체 이벤트를 보관한다. 따라서: **클라이언트는 `digest`를 보여주고, 서버 로그가 진실을 담으며, `correlationId`가 둘을 잇는다.**(클라이언트 컴포넌트 에러는 진짜 메시지를 유지하지만, 사용자에게 보이는 무엇이든 raw `message`보다 레지스트리 `userMessageKey`를 여전히 선호한다.)

### 6.3 `userMessageKey`를 위한 i18n — `t()` 공백 메우기

§6.1과 §8.4 전반에 걸쳐 설계는 사용자 카피를 `t(error.userMessageKey)`로 렌더하지만, `t`는 결코 정의·import·결선되지 않았고, 루트 레이아웃을 *대체*하여 React 프로바이더를 전혀 마운트하지 않는 `global-error.tsx`는 컨텍스트 기반 `t`를 결코 읽을 수 없었다. r3은 엄격한 불변식과 함께 i18n을 종단 간으로 결선한다: **raw 키는 결코 렌더되지 않는다.** 에러 코어는 작은 `Translator` 인터페이스에만 의존한다. 벤더 지식은 두 개의 어댑터 파일에 국한된다. 현재 라이브 CDP 프로젝트는 한국어 전용이므로(`<html lang="ko">`, antd `ko_KR`, i18n 패키지 미설치), 같은 위치에 둔 폴백 맵 하나만으로 *지금* 프로덕션을 온전히 충족한다. 어댑터는 두 번째 로케일이나 호스트 라이브러리가 도입될 때를 위한 옵트인이다.

```ts
// error/translator.ts
// error/translator.ts
// `userMessageKey`를 위한 i18n (설계 §6.3), 정본 모듈 맵에 따라
// 단일 모듈로 평탄화. 에러 코어는 작은 `Translator` seam에만 의존한다;
// 벤더 i18n 지식은 옵트인 어댑터에 위치한다(오늘은 미배포 — 라이브
// 프로젝트는 한국어 전용). 불변식: raw 키는 결코 렌더되지 않는다; resolveErrorMessage는
// 결코 throw하지 않는다.
//
// 참고 (모듈 맵 적응): 설계는 로케일별 중첩
// `FALLBACK_MESSAGES`(`Record<Locale, Record<ErrorCode, string>>`)를 유지했다. 모듈 맵은
// `FALLBACK_MESSAGES: Record<ErrorCode, string>`(단일 기본 로케일
// 컬럼)을 명시하므로, 맵은 한국어 기본 컬럼이고 `Translator.locale` seam은
// 다른 로케일을 해소하는 호스트 어댑터를 위해 유지된다.
import type { ErrorCode } from "./registry";
import { DEFAULT_ERROR_REGISTRY } from "./registry";

export type TranslateVars = Record<string, string | number>;

/** 라이브러리 독립적인 seam. 호스트 i18n 라이브러리가 이 뒤에 래핑된다. */
export interface Translator {
  /** 메시지 키를 완성된 문자열로 해소한다. raw 키를 반환해서는 안 된다(MUST NOT). */
  t(key: string, vars?: TranslateVars): string;
  /** 이 번역기가 해소하는 로케일(정보용; 호스트 어댑터가 사용한다). */
  readonly locale: string;
}

/**
 * 같은 위치에 둔(CO-LOCATED) 폴백 맵, `Record<ErrorCode, string>`로 타입 지정되어 누락된(혹은 여분의)
 * ErrorCode가 COMPILE 에러가 된다. 누락된 userMessageKey는 결코 런타임에 도달할 수 없다.
 * 기본 로케일(한국어) 컬럼 — 오늘 배포되는 유일한 로케일.
 */
export const FALLBACK_MESSAGES = {
  VALIDATION: "입력값을 확인해주세요.",
  INVALID_CREDENTIALS: "아이디 또는 비밀번호가 올바르지 않습니다.",
  AUTH_REQUIRED: "로그인이 필요합니다.",
  FORBIDDEN: "접근 권한이 없습니다.",
  NOT_FOUND: "요청하신 내용을 찾을 수 없습니다.",
  OFFLINE: "네트워크 연결이 끊겼습니다. 연결을 확인해주세요.",
  TIMEOUT: "요청 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.",
  REQUEST_ABORTED: "요청이 취소되었습니다.",
  NETWORK_ERROR: "네트워크 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
  HTTP_CLIENT_ERROR: "요청을 처리할 수 없습니다.",
  RATE_LIMITED: "{seconds}초 후 다시 시도해주세요.",
  HTTP_SERVER_ERROR: "서버에서 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
  SCHEMA_MISMATCH: "데이터 형식 오류가 발생했습니다.",
  UNKNOWN_SERVER_ERROR: "알 수 없는 오류가 발생했습니다.",
  UNKNOWN_CLIENT_ERROR: "알 수 없는 오류가 발생했습니다.",
} as const satisfies Record<ErrorCode, string>;

const GENERIC_FALLBACK = "알 수 없는 오류가 발생했습니다.";

/** 역방향 인덱스: userMessageKey 문자열 → ErrorCode. 레지스트리에서 한 번 빌드된다. */
const KEY_TO_CODE: Readonly<Record<string, ErrorCode>> = Object.freeze(
  (Object.keys(DEFAULT_ERROR_REGISTRY) as ErrorCode[]).reduce<Record<string, ErrorCode>>(
    (acc, code) => {
      acc[DEFAULT_ERROR_REGISTRY[code].userMessageKey] = code;
      return acc;
    },
    {},
  ),
);

/** 의존성 없는 폴백 경로를 위한 작은 `{token}` 보간. */
const interpolate = (template: string, vars?: TranslateVars): string =>
  vars
    ? template.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m))
    : template;

/**
 * `userMessageKey`(혹은 raw ErrorCode)에 대한 완성된 폴백 메시지를 조회한다.
 * 키가 알려진 레지스트리 userMessageKey도 아니고
 * 리터럴 ErrorCode도 아닐 때만 `undefined`를 반환한다.
 */
const fallbackMessage = (key: string, vars?: TranslateVars): string | undefined => {
  const code = KEY_TO_CODE[key] ?? (key in FALLBACK_MESSAGES ? (key as ErrorCode) : undefined);
  if (code === undefined) return undefined;
  return interpolate(FALLBACK_MESSAGES[code], vars);
};

/**
 * 모든 소비자가 통과하는 단일 해소 함수.
 * 계층화됨: 1) 주입된 호스트 번역기  2) 같은 위치에 둔 폴백  3) 궁극의 일반 라인.
 * 보장: raw 키를 결코 반환하지 않으며, 결코 throw하지 않는다. global-error.tsx /
 * 보편 안전망을 위한 프로바이더 없는(번역기 인자 없는) 방식.
 */
export const resolveErrorMessage = (
  key: string,
  translator?: Translator | null,
  vars?: TranslateVars,
): string => {
  if (translator) {
    let hostResult: string | undefined;
    try {
      hostResult = translator.t(key, vars);
    } catch {
      hostResult = undefined; // 깨진 어댑터가 에러 UX를 결코 망가뜨려서는 안 된다
    }
    // i18next/next-intl 관례: 누락된 키는 키를 그대로 되돌려준다. 이를 거부한다.
    if (hostResult && hostResult !== key) return hostResult;
  }
  return fallbackMessage(key, vars) ?? GENERIC_FALLBACK;
};

/** 프로바이더도 i18n 라이브러리도 필요 없는 Translator — 보편 안전망. */
export const createFallbackTranslator = (locale = "ko"): Translator => ({
  locale,
  t: (key, vars) => fallbackMessage(key, vars) ?? GENERIC_FALLBACK,
});
```

*(구체화 과정에서 모듈 맵에 따라 이를 단일 `translator.ts`로 통합했다. `en` 컬럼과 `error/i18n/` 로케일별 분할은 문서화된 향후 확장이다 — §12 참조. `RATE_LIMITED` 라인은 `{seconds}` 카운트다운 템플릿 — `{seconds}초 후 다시 시도해주세요.` — 이며 동일한 `{token}` 보간을 통해 해소된다.)*
#### 6.3.1 향후 확장 — 다중 로케일 i18n (⚠️ 검증된 r5 트리에 포함되지 않음)

> 이 하위 절의 모든 내용(next-intl / react-i18next 어댑터, `translator-context.tsx` 프로바이더 + `useErrorTranslator`, 그리고 서버 측 `getErrorTranslator()` / `tError()` 헬퍼)은 **보류된** 다중 로케일 설계다. 이는 (위에서 단일 로케일 `translator.ts`를 제공하는) 컴파일되는 `/tmp/error-core` 트리의 일부가 **아니다**. 이 블록들은 두 번째 로케일이나 호스트 i18n 라이브러리가 도입될 때를 위한 청사진이며, 검증된 코드가 아니라 완전성을 위해 제시한 것이다.

```ts
// error/i18n/adapters/next-intl-adapter.ts — next-intl의 존재를 알도록 허용된 유일한 파일.
// 옵트인: 오늘은 배선되지 않음. 실제 배선: createNextIntlTranslator(useTranslations(), locale).
import type { Translator, TranslateVars } from "../translator";
import type { Locale } from "../locale";

type NextIntlT = (key: string, values?: Record<string, string | number>) => string;

export const createNextIntlTranslator = (t: NextIntlT, locale: Locale): Translator => ({
  locale,
  t: (key, vars?: TranslateVars) => t(key, vars),
});
```

```ts
// error/i18n/adapters/react-i18next-adapter.ts — react-i18next의 존재를 알도록 허용된 유일한 파일.
import type { Translator, TranslateVars } from "../translator";
import type { Locale } from "../locale";

type I18nextT = (key: string, options?: Record<string, string | number>) => string;

export const createReactI18nextTranslator = (t: I18nextT, locale: Locale): Translator => ({
  locale,
  t: (key, vars?: TranslateVars) => t(key, vars),
});
```

```tsx
// error/i18n/translator-context.tsx  ('use client')
// 기본값은 프로바이더가 없는 FallbackTranslator이므로, ErrorTranslatorProvider가 마운트되지 않은 상태로
// 컨텍스트를 읽는 컴포넌트도 여전히 실제 문구로 해소된다(키가 아니라).
"use client";
import { createContext, useContext, useCallback } from "react";
import type { Translator, TranslateVars } from "./translator";
import { createFallbackTranslator } from "./fallback-translator";
import { resolveErrorMessage } from "./resolve";
import { DEFAULT_LOCALE } from "./locale";

const TranslatorContext = createContext<Translator>(createFallbackTranslator(DEFAULT_LOCALE));

export const ErrorTranslatorProvider = TranslatorContext.Provider;

/** 모든 클라이언트 에러 소비자가 호출하는 훅. 항상 resolveErrorMessage를 거친다. */
export const useErrorTranslator = (): {
  t: (key: string, vars?: TranslateVars) => string;
  translator: Translator;
} => {
  const translator = useContext(TranslatorContext);
  const t = useCallback(
    (key: string, vars?: TranslateVars) => resolveErrorMessage(key, translator, vars),
    [translator],
  );
  return { t, translator };
};
```

```ts
// error/i18n/server.ts  (server-only) — 요청별 서버 translator. 모듈 수준 상태 없음.
import "server-only";
import { cookies } from "next/headers";
import type { Translator, TranslateVars } from "./translator";
import { createFallbackTranslator } from "./fallback-translator";
import { resolveErrorMessage } from "./resolve";
import { DEFAULT_LOCALE, isLocale, type Locale } from "./locale";

const readLocale = async (): Promise<Locale> => {
  const c = await cookies();
  const v = c.get("NEXT_LOCALE")?.value;
  return isLocale(v) ? v : DEFAULT_LOCALE;
};

/** 요청별 서버 translator. next-intl이 도입되면 createNextIntlTranslator(await getTranslations(), locale)로 교체한다. */
export const getErrorTranslator = async (): Promise<Translator> =>
  createFallbackTranslator(await readLocale());

/** 편의: 서버 측에서 키 하나를 해소한다(예: Route Handler 내부). */
export const tError = async (key: string, vars?: TranslateVars): Promise<string> =>
  resolveErrorMessage(key, await getErrorTranslator(), vars);
```

**계층화된, 절대 throw하지 않는 해소.** 모든 소비자는 `resolveErrorMessage(key, translator?, vars?)`를 통과하는데, 이 함수는 키를 그대로 되돌려주는 호스트 translator(i18next/next-intl의 누락 키 관례)를 미스로 취급해 폴스루(fall through)하며, 어댑터 예외를 삼킨다 — 즉 i18n 배선이 깨지더라도 에러 UI를 망가뜨리는 대신 올바른 폴백 문구로 우아하게 강등된다. 클라이언트 컴포넌트는 `useErrorTranslator()`를 호출하며(그 컨텍스트는 프로바이더 없는 `FallbackTranslator`를 *기본값*으로 한다), 서버 코드는 모듈 수준 상태 없이 요청별로 `getErrorTranslator()` / `tError()`를 호출한다. 크롬 문자열 `error.retry`/`error.retryHint`/`error.unknown`은 레지스트리의 `userMessageKey`가 아니다. 이들은 호스트 translator + 범용 최후 수단에 의존한다(이들을 보장하고 싶다면 동일한 형태의 별도 `UI_FALLBACK` 맵을 추가하라 — 레지스트리 키 맵을 오염시키지 말 것). CI 완전성 테스트는 §10에 있다.


---
## 7. 서버 측

### 7.1 Server Actions / Commands — `Result`(뮤테이션) 경로

이것은 **뮤테이션** 트랙이다. Next의 규칙과 시리즈의 Track 1을 따른다: **의도한(expected) → `Result` 반환**, **예기치 못한 것 → report 후 재던지기**(`error.tsx`가 포착). 쿼리는 이를 사용하지 **않는다** — 쿼리는 throw 한다(§7.3, §8.4). **r3:** `Failure.error`는 이제 `toClientSerialized`(§5.2)가 생성하는 `ClientSerializedError`다 — message가 없고 details가 게이트된 DTO — 따라서 클라이언트로 건너가는 뮤테이션 실패는 자유 텍스트 `message`나 내부 `details`를 결코 누출하지 않는다.

```ts
// error/result.ts  (직렬화 안전 계약; 클라이언트로 전달되는 payload는 게이트됨)
import type { DomainError } from "./app-error";
import { toClientSerialized, type ClientSerializedError } from "./serialize";

export type Success<T> = { ok: true; data: T };
export type Failure = { ok: false; error: ClientSerializedError };
export type Result<T> = Success<T> | Failure;
export const actionSuccess = <T>(data: T): Success<T> => ({ ok: true, data });
export const actionFailure = (e: DomainError): Failure => ({ ok: false, error: toClientSerialized(e) });
```

```ts
// error/safe-server-action.ts  — RPC 스타일 뮤테이션 경계.
// Track 1 (의도한 비즈니스 에러) → 직렬화 안전한 `Result` Failure로 반환.
// Track 2 (예기치 못한 것) → 요청별 핸들러에서 report 후 재던지기(error.tsx가 포착).
// 프레임워크 제어 흐름(redirect/notFound/forbidden/unauthorized)은 결코
// 삼켜지지 않는다 — rethrowControlFlow가 네 가지 인터럽트를 모두 손대지 않고 다시 표면화한다.
import "server-only";
import { z } from "zod";
import { isDomainError, isExpectedCode } from "./app-error";
import { rethrowControlFlow } from "./next-control-flow";
import { actionSuccess, actionFailure, type Result } from "./result";
import { makeError } from "./make-error";
import { getRequestHandler } from "./request-handler.server";

export const safeServerAction =
  <S extends z.ZodTypeAny, R>(schema: S, action: (data: z.infer<S>) => Promise<R>) =>
  async (raw: z.infer<S>): Promise<Result<R>> => {
    const handleServerError = await getRequestHandler(); // ← await: 요청별 인스턴스
    try {
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        return actionFailure(
          makeError({
            code: "VALIDATION",
            details: {
              fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
            },
          }),
        );
      }
      return actionSuccess(await action(parsed.data));
    } catch (error) {
      // 1. 프레임워크 제어 흐름(redirect/notFound/forbidden/unauthorized)은 결코 삼키지 않는다.
      rethrowControlFlow(error);
      // 2. Track 1: 의도한 비즈니스 에러 → Failure로 반환(직렬화 안전).
      if (isDomainError(error) && isExpectedCode(error.code)) return actionFailure(error);
      // 3. Track 2: 예기치 못한 것 → report(서버 presenter no-op) 후 재던지기.
      // present:"silent" — 서버에는 DOM이 없으며 error.tsx로 재던진다;
      // 사용자에게 보이는 영향(과 그 breadcrumb)은 여기가 아니라 클라이언트에서 기록된다.
      handleServerError(error, { present: "silent" });
      throw error;
    }
  };
```

> 여기서 `handleServerError`는 `ResolvedAppError`(§5.4)를 반환한다. `safeServerAction`은 반환값을 무시하므로(재던지기를 하기 때문에) 이 호출 지점에서는 시그니처 변경이 투명하게 드러나지 않는다. Track-2 report는 `present:"silent"`를 전달한다(`present:"toast"`/`"alert"`가 아니다): 서버에는 DOM이 없으므로 `handleError`는 fault를 report하고 어떠한 Presenter 호출에도 이르지 않는다 — 그리고 영향(impact) breadcrumb은 `present !== "silent"`일 때만 발화하므로, 서버는 breadcrumb 또한 방출하지 않는다. 사용자에게 보이는 영향(impact)(과 그 breadcrumb)은 재던져진 에러가 클라이언트에서 표면화될 때 기록된다.

### 7.1a 요청별 서버 핸들러 조회 + 폼 액션 경계

§7.1은 `getRequestHandler()`를 호출하지만, r2는 그 인스턴스가 어떻게 빌드되거나 스코프되는지를 정의한 적이 없으며 — `serverDeps`도 정의하지 않았다. 둘 다 여기서 정의하며, 더불어 `useActionState`와 합성되는 형제 **`safeFormAction`** 경계와, 두 경계 모두가 의존하는 실제 `next-control-flow` 모듈도 함께 정의한다.

**왜 React `cache()`인가.** 서버 `handleServerError`는 요청별 `correlationId`와 사용자 신원을 실어 나르는 `TelemetryContext`를 클로저로 감싼다. Node는 모듈을 캐시하므로, 모든 모듈 수준 `let handler`/`let ctx`는 그 워커에서 동시에 처리되는 모든 요청에 의해 공유된다 — 요청 B가 요청 A의 `correlationId`와 사용자를 report하게 된다. 해결책은 **요청 스코프** 메모이제이션이다: React의 `cache()`는 App Router에서 요청마다 새로운 메모 저장소를 할당한다(이 레포가 `getServerSupabase`/`verifySession`에 사용하는 것과 동일한 메커니즘이다). 따라서 `getRequestHandler()`는 async이며 `cache()`로 감싸진다.

**서버 컴포지션 루트, 하나의 모듈로 축약됨.** r5는 설계가 원래 `server-deps` / `session` / `get-request-handler`로 나누어 두었던 것을 단일 `server-only` 모듈 `request-handler.server.ts`로 접어 넣는다. 이 모듈은 세 가지 표면을 모두 노출한다: `serverDeps`(요청 독립적인 싱크 선택, 모듈 로드당 한 번 빌드됨 — `correlationId`/사용자는 없으며, 이들은 요청별 ctx에 실린다), `getRequestCorrelationId`(React `cache()`를 통한 요청 스코프 correlation ID), 그리고 `getRequestHandler`(요청별 `handleServerError`). 또한 `serverReporter`를 export 한다 — 가드된 컴포지트 reporter로, `/health` 라우트가 `HandleErrorDeps`를 넓히지 않고도 `serverReporter.health()`를 읽을 수 있도록 자체 타입 핸들로 유지된다(아래의 dead-man-switch(데드맨 스위치) 배선).

```ts
// error/request-handler.server.ts   ('server-only')
// 서버 컴포지션 루트 + 요청별 핸들러 조회를, 하나의
// server-only 모듈로 축약(설계는 이를 server-deps / session /
// get-request-handler 로 나누었으나; 정본 모듈 맵은 세 표면을 모두 여기서 노출한다).
//
//   - serverDeps               : 요청 독립적인 싱크 선택(모듈 로드당 한 번
//                                빌드됨 — correlationId/사용자 없음; 이들은
//                                요청별 ctx에 실린다). Sentry + console reporter,
//                                no-op presenter, 그리고 pager notifier를 합성한다.
//   - getRequestCorrelationId  : 요청 스코프 correlation ID (React cache()).
//   - getRequestHandler        : 요청별 `handleServerError`, React cache()를 통해
//                                요청 스코프로 처리되며, runWithErrorRegistry를 통해
//                                serverDeps.registry에 바인딩되어 getter들이 요청의
//                                레지스트리를 해석하도록 한다. 모듈 수준의 가변 ctx/handler는
//                                금지된다 — 동시 요청 간에 누출될 것이다.
import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { createHandleError, type HandleErrorOptions } from "./handle-error";
import { runWithErrorRegistry } from "./active-registry";
import type { ResolvedAppError } from "./app-error";
import type { HandleErrorDeps } from "./types";
import type { Presenter } from "./telemetry";
import type { TelemetryContext } from "./telemetry";
import type { Notifier } from "./notifier";
import { DEFAULT_ERROR_REGISTRY } from "./registry";
import { guardedCompositeReporter, type GuardedCompositeReporter } from "./adapters/composite";
import { createSentryReporter } from "./adapters/sentry-reporter";
import { createConsoleReporter } from "./adapters/console-reporter";
import { createPagerNotifier, webhookPagerTransport } from "./adapters/pager-notifier";
import { noopNotifier } from "./notifier";

/** 서버 presenter는 no-op이다: DOM이 없다. 모든 서버 handleError 호출은 present:"silent"를 전달한다. */
const serverPresenter: Presenter = { present() {} };

/**
 * 서버 알림 싱크를 빌드한다. 페이징은 서버 런타임에 속하며 pager 어댑터가 소유하는
 * AlertPolicy 임계값에 의해 게이트된다. webhook이 설정되지 않은 경우
 * (테스트 / 로컬 / 프리뷰), handleError가 결코 알림을 보내지 않도록 no-op notifier로 폴백한다.
 */
const buildServerNotifier = (): Notifier => {
  const url = process.env.PAGER_WEBHOOK_URL;
  return url ? createPagerNotifier(webhookPagerTransport(url)) : noopNotifier;
};

/**
 * 가드된 컴포지트 reporter로, health 라우트
 * (src/app/api/health/route.ts)가 HandleErrorDeps를 넓히지 않고도 health()를 읽을 수 있도록
 * 자체 타입 핸들로 유지된다.
 * guardedCompositeReporter는 싱크별로 삼켜진 실패를 센다(데드맨 스위치);
 * 임계값을 넘어서는 health().failures가 바로 /health GET이 503으로 바꾸는 것이다.
 */
export const serverReporter: GuardedCompositeReporter = guardedCompositeReporter([
  { label: "sentry", reporter: createSentryReporter() },
  { label: "console", reporter: createConsoleReporter() },
]);

/**
 * 요청 독립적인 서버 deps. 모듈 스코프에서 빌드해도 안전한 이유는 정확히
 * 요청별 상태를 운반하지 않기 때문이다 — 사용자/correlation은 reporter가 아니라
 * 요청별 ctx에 실린다. 여기가 서버가 싱크를 고르는 유일한 곳이다.
 *
 * G10 데드맨 스위치 배선: serverReporter(가드된 컴포지트)는 싱크가 실패를 삼킬 때
 * 레이트 리밋된 최후의 수단 라인을 stderr로 자체 방출하며,
 * /health 프로브를 위해 health()를 노출한다. 에스컬레이션 계약은 다음과 같다: health().failures가
 * 라우트의 임계값을 넘어서면 /health는 503을 반환하고 운영자의 가동 시간 모니터가
 * 503에 대해 페이징한다. 대신 인프로세스로 페이징하려면(외부 모니터 없이), 호스트는
 * 임계값 초과 시 serverDeps.notifier.notify(...)를 호출하는
 * CompositeReporterOptions 훅을 전달할 수 있다 — notify()가
 * DomainError + severity + TelemetryContext를 필요로 하고, 삼킴 지점에는 이들 중 어느 것도 존재하지 않으므로
 * 이 독립 빌드에서는 제외했다; /health 503 + 외부 모니터가 배선된 기본값이다. (route.ts 참조.)
 */
export const serverDeps: HandleErrorDeps = {
  registry: DEFAULT_ERROR_REGISTRY,
  reporter: serverReporter,
  presenter: serverPresenter,
  notifier: buildServerNotifier(),
};

/** 소비자가 구조 분해하는 형태: `const handleServerError = await getRequestHandler()`. */
export type HandleServerError = (
  input: unknown,
  options?: HandleErrorOptions,
) => ResolvedAppError;

/**
 * Session → TelemetryContext.user. throw 하거나 redirect 해서는 안 된다(라우트 가드
 * verifySession과 달리): 에러 핸들러는 익명/실패한 요청에 대해서도 빌드 가능해야 한다.
 * cache()로 처리되어 조회가 요청별로 공유된다. 이 독립 빌드는
 * 배선된 auth 프로바이더가 없으므로 익명으로 해석된다; 실제 컴포지션 루트에서
 * 호스트 세션 조회(예: getServerSupabase().auth.getUser())로 교체하라.
 */
const getSessionUser = cache(
  async (): Promise<NonNullable<TelemetryContext["user"]> | null> => {
    try {
      return null; // 세션 프로바이더가 배선되지 않은 경우 익명 ctx가 올바르다
    } catch {
      // Auth 실패가 에러 처리를 막아서는 안 된다. 익명 ctx가 올바르다.
      return null;
    }
  },
);

/**
 * 요청 스코프 correlation ID. 인바운드의 형식이 올바른 `x-request-id`를 존중하며
 * (proxy.ts가 발급 — §9), 그렇지 않으면 최후의 수단 폴백을 발급한다. cache()는
 * 이 요청 내의 모든 호출자가 동일한 ID를 보도록 보장한다.
 */
export const getRequestCorrelationId = cache(async (): Promise<string> => {
  const h = await headers();
  const incoming = h.get("x-request-id");
  return incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
});

/**
 * `handleServerError`를 지연 빌드 + 요청별로 메모이제이션한다. async여야 한다(headers()
 * + session을 await 한다). active registry는 runWithErrorRegistry를 통해 이 요청에
 * 바인딩되어 getter들이 오직 이 요청에 한해서만 serverDeps.registry에 대해 해석되도록 한다.
 * React cache()는 App Router에서 요청별로 메모이제이션한다 — 두 동시
 * 요청은 결코 서로의 메모이제이션된 값을 관찰하지 않는다.
 */
export const getRequestHandler = cache(async (): Promise<HandleServerError> => {
  const [correlationId, user] = await Promise.all([
    getRequestCorrelationId(),
    getSessionUser(), // 미인증 시 null — 결코 throw/redirect 하지 않는다
  ]);
  const ctx: TelemetryContext = { runtime: "server", correlationId, user };
  const handle = createHandleError(serverDeps, ctx);
  // 반환된 핸들러 내부의 모든 getter 읽기가 요청의 레지스트리를 해석하도록 감싼다.
  return (input, options) =>
    runWithErrorRegistry(serverDeps.registry, () => handle(input, options));
});
```

> **격리 보장.** 동일한 워커에서 동시에 처리되는 임의의 두 요청 R1, R2에 대해, 이들이 획득하는 `handleServerError` 인스턴스는 서로소인 `TelemetryContext` 객체를 클로저로 감싼다: `ctx(R1).correlationId ≠ ctx(R2).correlationId`이며 `ctx(R1).user`는 R1의 사용자로서 결코 R2의 것이 아니다. 단일 요청 내에서는 반복되는 `getRequestHandler()` 호출이 동일하게 메모이제이션된 인스턴스를 반환한다. 이는 `cache()`가 **모듈 스코프가 아닌 요청 스코프**이기 때문에 성립한다. §10의 동시 요청 테스트는 정확히 이것을 단언하며, 금지된 모듈 수준 가변 대안이 실제로 누출됨을 입증하는 동반 테스트를 포함한다.

**프레임워크 제어 흐름 심(shim)** — "이것이 프레임워크 인터럽트인가?"에 대한 단일 진실 공급원으로, Next 자체의 `unstable_rethrow`를 우선한다(redirect, notFound, 그리고 실험적 forbidden/unauthorized를 한 번의 호출로 모두 포괄한다):

```ts
// error/next-control-flow.ts
import "server-only";
import { unstable_rethrow } from "next/navigation";

const digestOf = (e: unknown): string | undefined =>
  typeof e === "object" && e !== null && "digest" in e && typeof (e as { digest: unknown }).digest === "string"
    ? (e as { digest: string }).digest
    : undefined;

export const isRedirectError = (e: unknown): boolean => digestOf(e)?.startsWith("NEXT_REDIRECT") ?? false;
export const isNotFoundError = (e: unknown): boolean => digestOf(e) === "NEXT_NOT_FOUND";
/** 실험적 forbidden()/unauthorized()를 포괄한다 — 이들은 NEXT_HTTP_ERROR_FALLBACK;<status>를 throw 한다. */
export const isHttpAccessFallbackError = (e: unknown): boolean =>
  digestOf(e)?.startsWith("NEXT_HTTP_ERROR_FALLBACK") ?? false;

export const isFrameworkControlFlow = (e: unknown): boolean =>
  isRedirectError(e) || isNotFoundError(e) || isHttpAccessFallbackError(e);

/** 모든 프레임워크 제어 흐름 신호를 손대지 않고 재던진다; 그렇지 않으면 반환한다. */
export const rethrowControlFlow = (e: unknown): void => {
  try {
    unstable_rethrow(e); // `e`가 프레임워크 신호이면 throw; 그렇지 않으면 반환
  } catch (rethrown) {
    throw rethrown;
  }
  if (isFrameworkControlFlow(e)) throw e; // predicate 경로를 위한 이중 안전 장치
};
```

**`safeFormAction` — 폼 뮤테이션 경계.** `safeServerAction`은 명령형으로 `await` 하는 RPC 모양의 호출(`(typedArgs) => Promise<Result<R>>`)을 감싼다. React의 `useActionState`는 자신의 액션을 `(prevState, payload) => newState`로 호출하며, 점진적으로 향상된 `<form action>`의 경우 payload는 원시 `FormData`다. 두 시그니처는 합성되지 않으므로, r3는 형제 어댑터를 추가한다 — 한 번, 그리고 올바르게 작성된다. r5는 payload를 `Object.fromEntries(formData)`로 파싱하고(Zod가 강제 변환을 소유한다) 예기치 못한 경로를 `present:"silent"`로 report 한다.

```ts
// error/safe-form-action.ts  — 폼 뮤테이션 경계, useActionState 호환.
// 시그니처는 `(prevState, formData) => Promise<Result<R>>`이므로
// React의 useActionState 및 점진적으로 향상된 <form action>과 직접 합성된다. safeServerAction과
// 동일한 제어 흐름 + 리포팅 배관을 공유한다; 차이는 오직 입력
// 적응에서만 난다(원시 FormData → Zod 파싱 전 plain object).
import "server-only";
import { z } from "zod";
import { isDomainError, isExpectedCode } from "./app-error";
import { makeError } from "./make-error";
import { rethrowControlFlow } from "./next-control-flow";
import { getRequestHandler } from "./request-handler.server";
import { actionSuccess, actionFailure, type Result } from "./result";

/** useActionState가 폼에 대해 보유하는 상태: 이전 Result, 또는 첫 제출 전 null. */
export type FormState<R> = Result<R> | null;

export const safeFormAction =
  <S extends z.ZodType, R>(
    schema: S,
    action: (input: z.infer<S>, prevState: FormState<R>) => Promise<R>,
  ) =>
  async (prevState: FormState<R>, formData: FormData): Promise<Result<R>> => {
    let parsed: z.SafeParseReturnType<unknown, z.infer<S>>;
    try {
      // Object.fromEntries는 FormData를 plain object로 축약한다; Zod가 강제 변환을 소유한다.
      parsed = schema.safeParse(Object.fromEntries(formData));
    } catch (error) {
      // safeParse는 결코 throw 하지 않는다; 여기서의 throw는 프로그래머/런타임 fault → 예기치 못한 경로.
      rethrowControlFlow(error);
      const handleServerError = await getRequestHandler();
      handleServerError(error, { present: "silent" });
      throw error;
    }

    if (!parsed.success) {
      return actionFailure(
        makeError({
          code: "VALIDATION",
          details: {
            fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
          },
        }),
      );
    }

    try {
      return actionSuccess(await action(parsed.data, prevState));
    } catch (error) {
      // 1. 프레임워크 제어 흐름(redirect/notFound/forbidden/unauthorized)은 결코 삼키지 않는다.
      rethrowControlFlow(error);
      // 2. 의도한 비즈니스 에러 → Failure로 반환(직렬화 안전, 클라이언트로 건너간다).
      if (isDomainError(error) && isExpectedCode(error.code)) return actionFailure(error);
      // 3. 예기치 못한 것 → 요청별 핸들러에서 report(서버 presenter no-op) 후 재던지기.
      // present:"silent" — 서버에는 DOM이 없다; 클라이언트가 영향을 표면화 + breadcrumb 한다.
      const handleServerError = await getRequestHandler();
      handleServerError(error, { present: "silent" });
      throw error;
    }
  };
```

**언제 어느 것을 쓰는가.** 호출이 `useActionState` / `<form action>`에 의해 구동되고 payload가 `FormData`일 때마다(점진적으로 향상된 제출: 로그인, 생성/수정, 설정) `safeFormAction`을 사용한다. 뮤테이션 트랙의 그 외 모든 것에는 `safeServerAction`을 사용한다: 명령형으로 `await` 하는 RPC 스타일 명령, `useMutation`의 `mutationFn`, 또는 다른 서버 모듈. 둘 다 `Result<R>`을 반환하고, 동일한 제어 흐름 + 리포팅 배관을 공유하며, 쿼리 트랙은 건드리지 않는다 — 둘은 입력 적응에서만 차이가 난다.
### 7.1b 공개 배럴 — 클라이언트 안전 vs 서버 전용 (G13)

r5는 이름 붙은 두 개의 배럴로 런타임 누출 간극을 봉인한다. **모노레포(r6)에서 이 두 배럴은 `error-next` 패키지가 소유한다**: 기능/UI 코드는 `error-next`(클라이언트 안전)에서 import 하고, 서버 코드(Server Actions, Route Handlers, RSC 데이터 계층)는 `error-next/server`에서 import 한다. `error-next`의 클라이언트 배럴은 `error-core`의 클라이언트 안전 표면을 전량 재노출(`export * from "error-core"`)하고 그 위에 React/Next 진입점(`useErrorHandler`/`makeQueryClient`/컴포넌트)을 더한다 — `error-core`가 단일 물리 모듈이므로 클라이언트 싱글턴 sink(`handler.ts`)가 양쪽에서 동일 인스턴스로 공유된다. 클라이언트 안전 그래프에 속한 어떤 것도 `"server-only"`를 import 하지 않으므로 브라우저 번들에서 평가해도 안전하다(앱의 클라이언트 컴포넌트가 `error-next` 배럴을 import한 채 `next build`에 성공하는 것이 이 불변식의 경험적 증명이다 — `"server-only"`가 클라이언트 그래프에 섞였다면 빌드가 실패한다). 서버 배럴은 `import "server-only"`를 지니므로 길 잃은 클라이언트 import 는 런타임 누출이 아니라 **빌드** 오류가 된다. (`error-core`도 자체 커널 배럴 `error-core`를 가지며, 통합 계층 없이 커널만 쓰려는 소비자를 위한 것이다.)

```ts
// packages/error-next/src/index.ts  — G13 클라이언트 안전 공개 표면(모노레포 r6).
// UI/기능 코드가 사용하는 단 하나의 import 경로(`error-next`). 여기서 재export 되는 모든 것은
// 클라이언트 번들에서 평가해도 안전하다: 이 그래프의 어떤 것도 "server-only"를 import 하지 않는다.
// 서버 전용 진입점은 대신 `error-next/server` 에 있다.

// 1) error-core의 클라이언트 안전 표면 전량 재노출(makeError, isDomainError, DomainError,
//    ErrorCode, actionSuccess/actionFailure/Result, resolveErrorMessage, fieldErrorsFromError,
//    handleError/initHandleError, 텔레메트리 계약 …). 동일 모듈 인스턴스 → 싱글턴 sink 공유.
export * from "error-core";

// 2) React/Next 클라이언트 통합(이 패키지가 소유).
export { useErrorHandler } from "./use-error-handler";
export {
  makeQueryClient,
  createAppQueryClient,
  buildQueryClientConfig,
  shouldRetryQuery,
  MAX_QUERY_RETRIES,
} from "./query-client";
export { ErrorRegistryProvider, useErrorRegistry } from "./registry-context";
export { ErrorFallback } from "./components/ErrorFallback";
export { ErrorHandlerInit } from "./components/ErrorHandlerInit";
```

```ts
// packages/error-next/src/server.ts  — G13 서버 전용 공개 표면(모노레포 r6, `error-next/server`).
// 서버 코드(Server Actions, Route Handlers, RSC 데이터 계층)가 사용하는 단일 import 경로.
// "server-only" 가드는 길 잃은 클라이언트 import 를 런타임 누출이 아니라 빌드 오류로 만든다 —
// 이 모듈들은 node:async_hooks(액티브 레지스트리 스토어), next/headers, pager 트랜스포트를
// 끌어오며, 그중 어느 것도 브라우저 번들에 도달해서는 안 된다.
import "server-only";

// 뮤테이션 경계 — Track-1 Result / Track-2 report+rethrow.
export { safeServerAction } from "./safe-server-action";
export { safeFormAction, type FormState } from "./safe-form-action";

// 쿼리 → 프레임워크 인터럽트 브리지 (notFound/redirect/forbidden).
export { raise } from "./raise";

// 요청별 핸들러 + 컴포지션 루트 + 요청 범위 correlation id.
export {
  getRequestHandler,
  getRequestCorrelationId,
  serverDeps,
  serverReporter,
  type HandleServerError,
} from "./request-handler.server";

// Route Handler 오류 → HTTP Response 매퍼 (메시지 없음, 세부정보 게이팅 본문). core 구현 재노출.
export { toErrorResponse } from "error-core/route-handler";

// 서버측 재시도(retryable + Retry-After 존중). BackoffConfig/DEFAULT_BACKOFF는 error-core가 단일 출처.
export { withRetry, type WithRetryOptions } from "./with-retry";
```

> 이 분리는 관례가 아니라 import 그래프로 강제된다. `error-next`는 전이 그래프에 `"server-only"`가 없는 모듈만 재export 하며, `error-next/server`는 뮤테이션 경계, `raise`, 요청별 핸들러/컴포지션 루트, Route-Handler 응답 매퍼의 유일한 본거지다. `serverReporter`는 서버 배럴에서 재export 되므로 `/health` 라우트(§7.5)가 deps 가 사용하는 것과 동일한, 가드된 컴포지트에서 `health()`를 읽을 수 있다. 모노레포에서 `serverReporter`/`getRequestCorrelationId`는 `import { … } from "error-next/server"`로, `ErrorFallback`은 `import { ErrorFallback } from "error-next"`로 끌어온다(§7.5 `/health` 라우트, §6.1 바운더리 예시 참조).

### 7.2 `notFound` / `redirect` / `forbidden` / `unauthorized` 제어 흐름

이들은 **프레임워크 인터럽트로 표현된 의도한(expected) 오류**다 — 레지스트리 코드에 매핑되지만 `Result`가 아니라 *프레임워크 시그널을 throw 함으로써 전달된다*. 규칙은 다음과 같다.

- 이들을 `try/catch`로 감싸지 **말고**, `redirect()`는 어떤 try 블록 **바깥**에서 호출한다. (경계에서는 `rethrowControlFlow`/`unstable_rethrow`가 이들을 손대지 않고 재throw 한다 — §7.1a.)
- 상태 의미를 맞춘다: 404→`notFound()`, **401(미인증)→`unauthorized()`**, **403(인증됨, 잘못된 역할)→`forbidden()`**, 내비게이션→`redirect()`.
- `forbidden`/`unauthorized`는 **실험적**(`experimental.authInterrupts`)이며, 루트 레이아웃에서는 호출할 수 없고, Next 가 프로덕션 비권장으로 표시한다. 따라서 **기능 플래그 뒤로 가드한다**. 프로덕션 안전 폴백은 401에 대해 `redirect('/login')`, 403에 대해 반환되는 `FORBIDDEN` `Result`(또는 `redirect('/403')`)이다.

```ts
// Server Component / 읽기 DAL
import { unauthorized, forbidden, notFound } from "next/navigation";

const session = await verifySession();
if (!session) unauthorized();                       // 401  (플래그된 실험적 — 노트 참조)
if (session.role !== "admin") forbidden();          // 403
const doc = await getDoc(id);
if (!doc) notFound();                               // 404
```

`AppError` → 인터럽트로의 브리지는 단일 헬퍼에 존재하므로 기능 코드는 선언적으로 유지된다. 이것이 **쿼리의** 의도한(expected) 오류가 서버에서 올바른 HTTP 페이지가 되는 방식이다.

```ts
// error/raise.ts  (server-only)
// 쿼리의 의도한 `DomainError` → 올바른 Next.js 프레임워크 인터럽트로의 브리지로,
// 기능/읽기-DAL 코드가 선언적으로 유지되게 한다. 이것이 쿼리의
// 의도한 오류가 서버에서 올바른 HTTP 페이지가 되는 방식이다.
import "server-only";
import { notFound, redirect, forbidden } from "next/navigation";
import type { DomainError } from "./app-error";

export function raise(error: DomainError): never {
  switch (error.code) {
    case "NOT_FOUND":
      notFound();
    // 폴스루 — notFound()는 `never`를 반환한다
    case "AUTH_REQUIRED":
      // G9 SEAM: 클라이언트 useErrorHandler 는 자신의 redirect 에
      // ?returnTo=<location.pathname+search>를 덧붙이지만, 서버는 여기서 클라이언트 URL 을 읽을 수 없다 — request.url
      // 은 사용자에게 보이는 주소창이 아니라 RSC/데이터 요청이다. 따라서 raise()는
      // 맨 "/login"으로 redirect 한다; 로그인 페이지가 인증 후 목적지를 세션에서 해석한다
      // (또는 호스트가 원래 경로를 쿠키에 담는 미들웨어를 배선하고
      // 로그인 페이지가 그것을 읽는다). 여기서 헤더로부터 returnTo 를 합성하지 말라.
      redirect("/login"); // 프로덕션 안전 401
    // 폴스루 — redirect()는 `never`를 반환한다
    case "FORBIDDEN":
      forbidden(); // experimental.authInterrupts 뒤로 게이팅됨; 아니면 redirect("/403")
    // 폴스루 — forbidden()은 `never`를 반환한다
    default:
      throw error; // 500-클래스 → error.tsx
  }
  // 도달 불가: notFound/redirect/forbidden 은 `never`를 반환한다
}
```

> **`returnTo` 이음새(G9).** `raise()`는 401을 빈 `/login`으로 redirect 하며, 의도적으로 `?returnTo=`를 합성하지 **않는다**. 서버에서는 클라이언트의 주소창을 읽을 수 없다 — `request.url`은 RSC/데이터 요청이지 사용자에게 보이는 위치가 아니다 — 따라서 여기서 만들어낸 어떤 `returnTo`도 잘못될 것이다. 인증 후 목적지는 로그인 페이지가 세션에서 해석하거나, 원래 경로를 쿠키에 담는 호스트 배선 미들웨어가 해석한다. *클라이언트* `useErrorHandler`가 실제 `returnTo`가 존재하는 유일한 곳이다(`location.pathname + search`를 읽는다). 두 계층은 설계상 서로 분리된 채 유지된다.

### 7.3 RSC 읽기, DAL, proxy

- **읽기 DAL**(리더, `import "server-only"`): **throw** 한다 — 결코 `Result`를 반환하지 않는다. 의도한(expected) 읽기 미스 → `throw makeError({ code: "NOT_FOUND", details: { resource } })`, 이를 Server Component 가 `raise()`(`notFound()`/`forbidden()`)를 통해 올바른 페이지로 바꾼다. 인프라 결함 → `handleServerError(error, { present: "silent" })` 후 `throw new Error("generic", { cause: error })` 하여 `error.tsx`가 잡고 원본은 결코 경계를 넘지 않게 한다. 이는 팀 규칙 "**TanStack Query / 쿼리는 `DomainError`를 throw 한다**"와 처음부터 끝까지 부합한다. 재시도 가능한 업스트림/DAL 호출은 `withRetry`로 감싼다(§8.6).
- **쓰기 DAL / 커맨드**: `safeServerAction` / `safeFormAction`(§7.1/§7.1a)을 통해 도달한다. 액션은 `Result`를 반환한다(의도한 경우 Failure, 예상치 못한 경우 report+throw). 라이터 자체는 `throw makeError(...)`를 할 수 있다. 액션 경계가 의도한 throw 를 `Failure`로 변환한다.
- **RSC 페이지**는 읽기 DAL 을 호출한다. 의도한 오류는 throw → 매칭되는 인터럽트로 `raise()`되고, 예상치 못한 오류는 `error.tsx`로 버블링된다.
- **proxy.ts**는 correlation ID(§9)를 만들고 거친(coarse) 인증을 강제하며, 인터럽트를 throw 하는 대신 `NextResponse.redirect`/`rewrite`를 반환한다(인터럽트는 proxy 에서 사용할 수 없다).

### 7.4 Route Handlers

래퍼가 `httpStatus`를 통해 어떤 `AppError`든 올바른 HTTP 상태로 매핑하며 correlation ID 를 부착한다. **r3:** 본문은 `toClientSerialized`(§5.2)다 — 메시지 없음, 세부정보 게이팅 — 따라서 Route Handler 오류 응답은 내부 `message`/`details`를 호출자에게 결코 누출하지 않는다.

```ts
// error/route-handler.ts
// `httpStatus`를 통해 어떤 AppError 든 올바른 HTTP 상태로 매핑하며 correlation
// ID 를 부착한다. 본문은 `toClientSerialized`(§5.2)다 — 메시지 없음, 세부정보 게이팅 — 따라서 Route
// Handler 오류 응답은 내부 `message`/`details`를 호출자에게 결코 누출하지 않는다.
import { isDomainError } from "./app-error";
import { makeError } from "./make-error";
import { toClientSerialized } from "./serialize-client";

export const toErrorResponse = (e: unknown, correlationId: string): Response => {
  const err = isDomainError(e)
    ? e
    : makeError({ code: "UNKNOWN_SERVER_ERROR", details: null, cause: e });
  return Response.json(toClientSerialized(err), {
    status: err.httpStatus,
    headers: { "x-request-id": correlationId },
  });
};
```

### 7.5 `/health` 프로브 — dead-man-switch(데드맨 스위치) 에스컬레이션 (G10)

컴포지트 reporter 는 **가드된다**(`adapters/composite.ts`): 싱크 실패를 삼켜서 텔레메트리가 결코 앱으로 throw 하지 않게 한다. 그 안전성에는 대가가 있다 — 조용히 망가진 Sentry 또는 console 싱크는 그렇지 않으면 보이지 않는다. `/health` 라우트가 이를 표면화한다. 이 라우트는 `serverReporter.health()`(`serverDeps.reporter`를 뒷받침하는 동일한 가드된 컴포지트로, `request-handler.server.ts`에서 재export 됨)를 읽고, 싱크별로 삼켜진 실패 카운트를 합산하며, **합계가 임계값을 넘어서면 503을 반환**하여 외부 가동시간 모니터의 5xx 알림이 온콜을 페이지하게 한다. 그 503-더하기-외부-모니터가 배선된 에스컬레이션이다. 인프로세스 대안(삼키는 지점에서 `serverDeps.notifier.notify(...)`를 호출하는 것)은 의도적으로 제외되었는데, `notify()`는 `DomainError` + 심각도 + `TelemetryContext`를 필요로 하지만 싱크가 삼키는 지점에는 그중 어느 것도 존재하지 않기 때문이다.

```ts
// app/api/health/route.ts  — G10 라이브니스/텔레메트리 헬스 프로브 (라우트별 서버 전용).
// 컴포지트 reporter 는 가드된다(adapters/composite.ts): 싱크 실패를 삼켜서
// 텔레메트리가 결코 앱으로 throw 하지 않게 하지만, 조용히 망가진 Sentry/console 싱크는
// 그렇지 않으면 보이지 않는다. 이 라우트가 이를 표면화한다: serverReporter.health()를 읽고
// 삼켜진 실패가 임계값을 넘어서면 503을 반환하여, 외부 가동시간 모니터가
// 온콜을 페이지하게 한다 (배선된 데드맨 스위치 에스컬레이션; request-handler.server.ts 참조).
import { serverReporter } from "@/error/request-handler.server";

export const dynamic = "force-dynamic"; // 헬스 판정은 결코 캐시하지 않는다
export const runtime = "nodejs"; // serverReporter 는 서버 전용 어댑터를 끌어온다

/**
 * 텔레메트리 파이프라인을 비정상으로 선언하기 전까지 우리가 용인하는
 * 삼켜진 텔레메트리 실패의 최대치(싱크들에 걸쳐 합산). 이를 넘으면 프로브가 503으로 뒤집힌다.
 */
const FAILURE_THRESHOLD = 5;

/** 싱크별 삼켜진 실패 카운트를 하나의 누적 합계로 합산한다. */
const totalFailures = (failures: ReadonlyMap<string, number>): number => {
  let total = 0;
  for (const n of failures.values()) total += n;
  return total;
};

export async function GET(): Promise<Response> {
  const health = serverReporter.health();
  const failures = totalFailures(health.failures);
  const healthy = failures < FAILURE_THRESHOLD;

  const body = {
    status: healthy ? "ok" : "degraded",
    telemetry: {
      failures,
      threshold: FAILURE_THRESHOLD,
      ...(health.lastFailureAt !== undefined
        ? { lastFailureAt: new Date(health.lastFailureAt).toISOString() }
        : {}),
      // 싱크별 분해로 온콜이 어느 싱크가 누락하고 있는지(sentry vs console)를 볼 수 있게 한다.
      bySink: Object.fromEntries(health.failures),
    },
  };

  // 비정상일 때 503 → 가동시간 모니터의 5xx 알림이 데드맨 스위치 페이지다.
  return Response.json(body, { status: healthy ? 200 : 503 });
}
```

> 싱크별 `bySink` 분해는 온콜이 단순한 합계가 아니라 *어느* 싱크가 누락하고 있는지(sentry vs console)를 볼 수 있게 하며, `lastFailureAt`(실패가 발생했을 때만 방출됨)은 가장 최근의 삼킴에 타임스탬프를 찍는다. `dynamic = "force-dynamic"`는 판정을 캐시되지 않게 유지하고, `runtime = "nodejs"`는 `serverReporter`가 서버 전용 어댑터를 끌어오기 때문에 필요하다.

---
## 8. 클라이언트 런타임

### 8.1 중앙 싱크 + 초기화

```ts
// error/handler.ts  (client singleton)  — §8.1
// 모듈 슬롯 싱글턴: initHandleError는 시작 시 핸들러를 한 번 생성하고
// 활성 레지스트리를 바인딩한다. handleError/setErrorUser는 다시 export된 싱크다.
// ============================================================================
import { createHandleError, type HandleErrorOptions } from "./handle-error";
import { setActiveErrorRegistry } from "./active-registry";
import type { HandleErrorDeps } from "./types";
import type { ResolvedAppError } from "./app-error";

let _handle: ((input: unknown, opts?: HandleErrorOptions) => ResolvedAppError) | null = null;

export const initHandleError = (deps: HandleErrorDeps, correlationId?: string): void => {
  setActiveErrorRegistry(deps.registry); // ← getters/isSerializedError가 이제 deps.registry와 일치한다
  _handle = createHandleError(deps, { runtime: "client", correlationId, user: null });
  deps.reporter.setContext({ correlationId });
};

export const handleError = (input: unknown, opts?: HandleErrorOptions): ResolvedAppError => {
  if (!_handle) {
    // dev 가드 — initHandleError()는 시작 시 한 번 실행되어야 한다 (ErrorHandlerInit).
    throw new Error(
      "initHandleError() not called: mount <ErrorHandlerInit /> once in app/layout.tsx before using handleError().",
    );
  }
  return _handle(input, opts);
};

export const setErrorUser = (
  user: { id: string; role?: string } | null,
  deps: HandleErrorDeps,
): void => {
  deps.reporter.setUser(user);
};
```

```tsx
// components/ErrorHandlerInit.tsx  ('use client')  — app/layout.tsx에 한 번 마운트됨
"use client";
import { useEffect } from "react";
import { initHandleError } from "@/error/handler";
import { buildClientDeps } from "@/error/build-deps";
export function ErrorHandlerInit({ correlationId }: { correlationId: string }) {
  useEffect(() => { initHandleError(buildClientDeps(), correlationId); }, [correlationId]);
  return null;
}
```

> 이제 클라이언트의 `handleError`는 `ResolvedAppError`를 반환한다. 이전에 `appError.code`/`appError.userMessageKey`를 읽던 호출 지점은 `result.error.code` / `result.error.userMessageKey`, 또는 — 가급적이면 — `result.policy.userMessageKey`를 읽는다. 아래 §8.4 예제는 두 방식을 모두 보여준다. 내부적으로 `handleError`는 (1) `log!=="none"`이면 fault를 보고하고, (2) 알림을 보내며, (3) `present`가 `"toast"`/`"alert"`인 경우에 **한정하여** Presenter를 호출하고, (4) `present!=="silent"`일 때마다 **영향(impact) breadcrumb(브레드크럼)**(`reporter.breadcrumb`)을 방출한다 — fault는 한 번만 캡처되고 사용자 영향(impact)은 별도로 기록되므로 로깅이 결코 중복되지 않는다.

### 8.2 `useErrorHandler` 훅 + `page` 에스컬레이션 메커니즘

`present:"page"`(`FORBIDDEN`이 사용)는 실행기가 없는 레지스트리 값이었다. 토스트 라이브러리는 전체 페이지 라우트를 마운트할 수 없으므로 `page`는 Presenter의 책임이 *아니다*(§5.4에서 no-op으로 만든다). 전체 페이지 전달은 클라이언트에서 `useErrorHandler`가 소유하는 **에스컬레이션**이다(서버에서는 `raise()`, §7.2). 즉, 정규화된 `DomainError`를 다시 던져 가장 가까운 `error.tsx`가 전체 페이지 상태를 렌더링하게 하거나, 코드가 매핑되어 있을 때 전용 라우트로 내비게이션한다.

```ts
// error/use-error-handler.ts  — §8.2  ('use client')
// 인터랙션 계층 진입점: 단일 처리 경로(handleError)를 실행한 뒤,
// Presenter가 할 수 없는 내비게이션/에스컬레이션 UX를 수행한다.
//   - "redirect" → router.push("/login?returnTo=<current path+search>") (G9 이음새)
//   - "page"     → 매핑되어 있으면 전용 라우트로 내비게이션 (FORBIDDEN → /403),
//                  그렇지 않으면 정규화된 DomainError를 다시 던져 가장 가까운
//                  error.tsx가 전체 페이지 상태를 렌더링하게 한다.
// ============================================================================
"use client";
import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { handleError } from "./handler";
import type { HandleErrorOptions } from "./handle-error";
import type { ResolvedAppError } from "./app-error";
import type { PresentAction } from "./policy";
import type { ErrorCode } from "./registry";

/**
 * "page" PresentAction을 위한 선택적 전용 라우트 맵. 여기에 존재하는 코드는
 * 가장 가까운 error.tsx로 다시 던지는 대신 그 라우트로 내비게이션한다.
 * 인라인 처리(별도 page-routes 모듈 없음)하여 이 파일이 정의하거나 매핑된 경로에서
 * import하지 않은 것을 참조하지 않게 한다.
 */
const PAGE_ROUTE_BY_CODE: Partial<Record<ErrorCode, string>> = {
  FORBIDDEN: "/403",
};

/**
 * NOTE: 다시 던지기 에스컬레이션은 이 핸들러가 렌더 중에 호출되거나 React가
 * 노출하는 경로 안에서 호출될 때에만 error.tsx에 도달한다. 순수 이벤트 핸들러에서는
 * 전용 라우트 내비게이션(PAGE_ROUTE_BY_CODE)을 선호하라.
 */
export const useErrorHandler = () => {
  const router = useRouter();
  return useCallback(
    (input: unknown, opts?: HandleErrorOptions): ResolvedAppError => {
      const result = handleError(input, opts);
      const present: PresentAction = result.policy.present; // 유효 액션 (호출별 override 반영)

      if (present === "redirect") {
        // G9: 로그인 후 되돌아갈 수 있도록 사용자가 있던 페이지를 보존한다.
        // 서버 raise()는 클라이언트 위치를 읽을 수 없으므로 returnTo를 여기에서 덧붙인다.
        const returnTo = encodeURIComponent(location.pathname + location.search);
        router.push("/login?returnTo=" + returnTo);
        return result;
      }
      if (present === "page") {
        const route = PAGE_ROUTE_BY_CODE[result.code];
        if (route) {
          router.push(route); // 전용 전체 페이지 라우트 (예: FORBIDDEN → /403)
        } else {
          throw result.error; // 가장 가까운 error.tsx로 에스컬레이션 (정규화된 인스턴스)
        }
      }
      // present가 toast/alert/inline/silent일 때 호출자는 result.code로 분기하여 제자리 UI를 렌더링한다
      return result;
    },
    [router],
  );
};
```

```ts
// error/safe-handler.ts — 인터랙션 경계 (§8.2)
// 이벤트 핸들러를 감싸 던져진 오류가 단일 클라이언트 싱크로 모이게 한다.
// ============================================================================
import { handleError } from "./handler";

export const safeHandler =
  <Args extends unknown[]>(fn: (...a: Args) => void | Promise<void>) =>
  async (...args: Args): Promise<void> => {
    try {
      await fn(...args);
    } catch (e) {
      handleError(e);
    }
  };
```

> `useErrorHandler`가 `page`에 대해 다시 던질 때, 이는 (원시 입력이 아니라) **정규화된** `result.error`를 다시 던지므로 `error.tsx`는 `digest`/`correlationId`가 이미 보고된 이벤트와 일치하는 안정적인 인스턴스를 받는다 — 그리고 `ErrorFallback`의 이펙트는 `log:"none"`으로 호출되므로 오류가 두 번 보고되지 않는다. 서버에서 `page`에 해당하는 것은 `raise()`이다(§7.2). 클라이언트의 다시 던지기와 서버의 `raise()`는 하나의 "page" 의미론의 두 얼굴이다. `redirect` 분기는 `returnTo` 쿼리 파라미터(현재 경로 + 검색, 클라이언트 측에서 캡처됨)를 덧붙이는데, 이는 서버 `raise()`가 클라이언트 위치를 읽을 수 없기 때문이다 — 이것이 G9의 로그인 후 복귀 이음새이다.

### 8.3 전역 window 캡처 (브라우저 경계 — final safety net)

브라우저 경계는 Sentry 폭주 스로틀(§5.3)이 작동하도록 자신의 라우트를 반드시 태그해야 한다 — `window.onerror`/`onunhandledrejection`은 렌더 루프에서 초당 수백 번 발화할 수 있다.

```ts
// error/browser-boundary.ts — 브라우저 경계 (final safety net) (§8.3)
// window.onerror / onunhandledrejection은 렌더 루프에서 초당 수백 번 발화할 수 있으므로,
// 각 경로는 자신의 라우트를 태그하여 Sentry 폭주 스로틀을 작동시킨다.
// ============================================================================
import { handleError } from "./handler";

export const initBrowserBoundary = (): void => {
  if (typeof window === "undefined") return;
  window.onerror = (_m, _s, _l, _c, error) =>
    void handleError(error ?? new Error("Unhandled (window.onerror)"), {
      present: "toast",
      log: "error",
      ctx: { route: "window.onerror" },
    });
  window.onunhandledrejection = (ev: PromiseRejectionEvent) =>
    void handleError(ev.reason ?? new Error("Unhandled rejection"), {
      present: "toast",
      log: "error",
      ctx: { route: "window.onunhandledrejection" },
    });
};
```

### 8.4 포착된 오류 → 레지스트리 → UI 매핑 (커맨드/쿼리 분리)

**전달 규칙 — 라이브러리가 아니라 연산으로 분리한다.** *뮤테이션*은 `Result`를 반환한다(business → `useActionState`를 통해 inline; 의도하지 않은(unexpected) 경우 → throw → `error.tsx`). *쿼리*(`useQuery` / RSC 읽기)는 **`DomainError`를 던지며** `data`에 business 오류를 결코 담지 않는다. 클라이언트에서는 business 오류를 `error`에서 읽고, 서버에서는 인터럽트로 `raise()`한다.

```tsx
// ── safeFormAction + useActionState를 통한 뮤테이션(폼) — 재작성된 login 예제 ──
// app/(auth)/login/actions.ts
"use server";
import { z } from "zod";
import { makeError } from "@/error/make-error";
import { safeFormAction, type FormState } from "@/error/safe-form-action";

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  remember: z.coerce.boolean().optional(), // 체크박스 "on" → true
});
export type LoginData = { userId: string };
export type LoginState = FormState<LoginData>; // Result<LoginData> | null

export const loginAction = safeFormAction(
  LoginSchema,
  async ({ email, password }, _prevState): Promise<LoginData> => {
    const user = await verifyCredentials(email, password); // DAL이 business DomainError를 던질 수 있다
    if (!user) {
      // business → DomainError를 던진다; 경계가 이를 Failure로 변환한다 (던져진 오류가 아니라).
      throw makeError({ code: "INVALID_CREDENTIALS", details: null });
    }
    return { userId: user.id };
  },
);

declare function verifyCredentials(email: string, password: string): Promise<{ id: string } | null>;
```

```tsx
// app/(auth)/login/LoginForm.tsx  ('use client')
"use client";
import { useActionState } from "react";
import { resolveErrorMessage } from "@/error/translator";
import { handleError } from "@/error/handler";
import { loginAction, type LoginState } from "./actions";

export function LoginForm() {
  // 초기 상태 = null (이전 제출 없음). action 시그니처 (prevState, formData)가 정확히 일치한다.
  const [state, formAction, pending] = useActionState<LoginState, FormData>(loginAction, null);

  // 모든 Failure를 handleError를 통해 ResolvedAppError로 정규화한다 (레지스트리 해석). 렌더는
  // present:"inline" && log:"none"일 때에만 실행된다 (VALIDATION/INVALID_CREDENTIALS가 해당, §1 렌더 안전성).
  const result = state && !state.ok ? handleError(state.error, { log: "none" }) : null;
  const appError = result?.error ?? null;

  return (
    <form action={formAction}>
      <input name="email" type="email" autoComplete="username" />
      {appError?.code === "VALIDATION" &&
        (appError.details as { fieldErrors: Record<string, string[]> }).fieldErrors.email?.map((m) => (
          <p key={m} role="alert">{m}</p>
        ))}

      <input name="password" type="password" autoComplete="current-password" />
      {/* Chrome 문자열(login.remember / login.submit)은 레지스트리 userMessageKey가 아니다 —
          한국어 전용 빌드에서는 평범한 리터럴이다 (호스트 translator가 나중에 처리한다). */}
      <label><input name="remember" type="checkbox" /> 로그인 상태 유지</label>

      {appError?.code === "INVALID_CREDENTIALS" && (
        <p role="alert">{resolveErrorMessage(result!.policy.userMessageKey)}</p>
      )}

      <button type="submit" disabled={pending}>로그인</button>
    </form>
  );
}
```

쿼리 트랙에서는 던져진 `VALIDATION` `DomainError`도 inline으로 렌더링될 수 있다 — 필드별 맵은 각 호출 지점에서 다시 도출하는 대신 `fieldErrorsFromError` 헬퍼로 오류에서 끌어낸다.

```ts
// error/field-errors.ts — G12 (쿼리 트랙 VALIDATION inline 분기 헬퍼).
// VALIDATION DomainError에서 필드별 검증 맵을 끌어내어 폼이 모든 호출 지점에서
// 형태를 다시 도출하지 않고도 inline 필드 오류를 렌더링할 수 있게 한다.
// 다른 모든 코드(또는 DomainError가 아닌 것)에 대해서는 null을 반환하므로, 호출자는
// `fieldErrorsFromError(err) ?? <generic>`로 깔끔하게 분기할 수 있다.
// ============================================================================
import { isDomainError } from "./app-error";

/**
 * 오류가 VALIDATION DomainError일 때 `error.details.fieldErrors`(Record<string, string[]>)를
 * 반환하고, 그렇지 않으면 null을 반환한다. VALIDATION details 스키마가
 * `fieldErrors` 형태를 보장하므로 narrow는 완전하다 — 캐스트가 새어 나가지 않는다.
 */
export const fieldErrorsFromError = (
  error: unknown,
): Record<string, string[]> | null => {
  if (!isDomainError(error, "VALIDATION")) return null;
  return error.details.fieldErrors;
};
```

```tsx
// ── 쿼리 (TanStack useQuery) → DomainError를 던진다 (단일 트랙) ──
// queryFn이 던진다; React Query가 `error`/`isError`를 통해 노출한다. Result-as-data 없음.
const { data, error, isError } = useQuery({
  queryKey: ["doc", id],
  queryFn: ({ signal }) => networkBoundary<DocDTO>(`/api/docs/${id}`, { signal }),  // 던지는 경계 (§8.5)
  // 진짜 의도하지 않은(fault/operational) 오류는 가장 가까운 error.tsx로 에스컬레이션한다; business 오류는 아래에서 inline으로 처리한다.
  throwOnError: (e) => !(isDomainError(e) && isExpectedCode(e.code)),
});
if (isError) {
  const { error: appError, policy } = handleError(error, { log: "none" }); // 경계에서 이미 보고됨
  const fieldErrors = fieldErrorsFromError(appError);
  if (fieldErrors) return <FieldErrors errors={fieldErrors} />;           // VALIDATION → 필드별 inline
  if (appError.code === "NOT_FOUND") return <Empty>{resolveErrorMessage(policy.userMessageKey)}</Empty>;
  if (appError.code === "FORBIDDEN") return <ForbiddenNotice />;
  return <Notice>{resolveErrorMessage(policy.userMessageKey)}</Notice>;
}
```

UI 계층은 항상 **정규화된 `AppError`** / `ResolvedAppError.policy`를 기준으로 분기하며, 원시 문자열을 기준으로 하지 않는다. `policy.present`는 inline 대 toast 대 page 대 redirect 대 silent를 결정하고, `policy.userMessageKey`(§6.3의 `t`를 통해 해석됨)는 문구를 결정하며, `error.code`는 모든 맞춤형 처리를 결정한다. **분리하는 이유:** 필드 수준 inline 오류 UX는 폼(뮤테이션)에서만 의미가 있으며, 그곳에서 `Result`가 빛을 발한다. 쿼리의 `data`에 business 오류를 담는 것은 읽기에서 아무런 이득 없이 "데이터가 오류를 담는다"는 비용을 강요하는데, 읽기에서는 `NOT_FOUND`/`FORBIDDEN`이 인터럽트 페이지나 `error` 분기를 원한다. 뮤테이션은 시리즈의 `Result`를 유지하고, 쿼리는 팀 문서의 throw를 채택한다 — 그리고 이제 둘은 합의에 이른다. 유일한 예외는 `VALIDATION`으로, 그 `present:"inline"`은 어느 트랙에서나 잘 읽힌다. `fieldErrorsFromError`는 쿼리 측 폼이 형태를 다시 도출하지 않고도 동일한 필드별 문구를 렌더링하게 해준다.
### 8.5 네트워크 경계 — `networkBoundary<T>` (쿼리 트랙의 변환 라인)

`networkBoundary`는 여섯 경계 중 다섯 번째이며, 원시 전송 결과(raw transport outcome)가 `DomainError`로 변하는 단일 지점이다. 이것은 *처리*(handle) 경계가 아니라 *변환*(transform) 경계다. 충실한 `DomainError`를 throw할 뿐 `handleError`를 절대 호출하지 않는다 — 보고는 정확히 한 번, 하류에서 throw가 소비되는 지점(쿼리 컨슈머 또는 `error.tsx`, 이들은 이후 `log:"none"`을 전달한다)에서 일어난다. 이것은 `OFFLINE`, `TIMEOUT`, `REQUEST_ABORTED`, `HTTP_CLIENT_ERROR`, `HTTP_SERVER_ERROR`, `RATE_LIMITED`, `SCHEMA_MISMATCH`, `NETWORK_ERROR`의 **유일한 생산자**다.

핵심을 떠받치는 규칙은 **non-ok 순서**다. `!res.ok`일 때 본문을 한 번 읽고 *먼저* `isSerializedError(await res.json())` → `DomainError.fromSerialized`를 시도하여, 서버가 선택한 코드가 무엇이든 보존한다(서버가 발행한 `FORBIDDEN`/`NOT_FOUND`가 온전히 도착한다 — 이것이 §8.4의 inline 분기를 쿼리에서 도달 가능하게 만드는 요소다). 본문이 우리의 와이어 계약(wire contract)이 아닐 때에 한해서만 상태 클래스(status-class) 매핑으로 후퇴한다. 취소는 `AbortSignal.any`로 합성되며, TIMEOUT 대 REQUEST_ABORTED는 **어떤 하부 시그널이 abort되었는가**로 구별한다(throw된 `AbortError`의 name으로 구별하지 않는다 — 합성 시그널은 그 name을 신뢰성 있게 전달하지 않는다). `429`는 파싱된 `Retry-After`를 동반한다(§8.6).

correlation은 이제 **양방향**이다(갭 수정 G8). r4에서 이 경계는 응답에서 서버의 `x-request-id`를 *끌어올리기만* 하여, 클라이언트 측 `DomainError`가 이미 발행된 서버 트레이스에 합류할 수 있게 했다. r5는 추가로 페이지 correlationId를 *아웃바운드로* **전송**한다. fetch 이전에 이 경계는 `proxy.ts`가 심어 둔 non-httpOnly `x-correlation-id` 쿠키를 읽어 요청의 `x-request-id` 헤더에 찍는다(드물게 호출자가 직접 공급한 `x-request-id`는 여전히 우선한다). 라우트 핸들러는 이 잘 형성된(well-formed) 인바운드 id를 새로 발행하는 대신 존중하므로, 클라이언트 요청과 서버 트레이스는 사후에 꿰매어 붙인 두 개의 id가 아니라 **end-to-end로 하나의 id**를 공유한다. 이 id는 사용 전 `^[\w-]{8,64}$`에 대해 검증되며, 아웃바운드 찍기는 서버에서는 no-op이다(`document`가 없음) — 서버에서는 바인딩된 활성 값이 이미 `await headers()`를 통해 함께 실려 가고, 응답 헤더 끌어올리기가 폴백으로 남는다.

```ts
// error/network-boundary.ts  — the Network 경계 (변환: raw transport → AppError). THROWING.
import { z } from "zod";
import { DomainError, isSerializedError, type SerializedError } from "./app-error";
import { makeError } from "./make-error";
import { parseRetryAfter } from "./retry-after";

export interface NetworkBoundaryOptions extends Omit<RequestInit, "signal"> {
  /** JSON 본문을 검증할 Zod 스키마. 파싱 실패 → SCHEMA_MISMATCH. */
  schema?: z.ZodTypeAny;
  /** 호출별 타임아웃. 기본값은 DEFAULT_TIMEOUT_MS. TIMEOUT을 발생시킨다. */
  timeoutMs?: number;
  /** 호출자 소유의 취소(예: React Query의 queryFn signal). REQUEST_ABORTED를 발생시킨다. */
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const REQUEST_ID_HEADER = "x-request-id";
const CORRELATION_COOKIE = "x-correlation-id"; // proxy.ts가 심어 둠 (non-httpOnly)
const ID_RE = /^[\w-]{8,64}$/;

/** 우리는 온라인인가? 서버에는 `navigator`가 없다; 부재는 "온라인"으로 취급한다. */
const isOnline = (): boolean =>
  typeof navigator === "undefined" || navigator.onLine !== false;

/** 클라이언트 에러가 서버 트레이스에 합류하도록 응답에서 서버의 correlation ID를 끌어올린다. */
const correlationFrom = (res: Response): string | undefined =>
  res.headers.get(REQUEST_ID_HEADER) ?? undefined;

/**
 * G8: 아웃바운드 페이지 correlationId. 클라이언트에서는 프록시가 심어 둔 non-httpOnly
 * `x-correlation-id` 쿠키를 읽는다; 그러면 라우트 핸들러는 새로 발행하는 대신
 * (proxy.ts의 well-formed-inbound 분기를 통해) 이 인바운드 id를 존중하므로,
 * 클라이언트 요청과 서버 트레이스가 end-to-end로 하나의 id를 공유한다.
 * 서버에서는 undefined를 반환한다(document 없음) — 거기서는 바인딩된 활성 값이
 * 이미 `await headers()`를 통해 함께 실려 가고, 응답 헤더 끌어올리기가 폴백이다.
 */
const outboundCorrelationId = (): string | undefined => {
  if (typeof document === "undefined") return undefined; // 서버: 여기서 읽을 것이 없음
  const match = document.cookie.match(/(?:^|;\s*)x-correlation-id=([^;]+)/);
  if (!match || match[1] === undefined) return undefined;
  const value = decodeURIComponent(match[1]);
  return ID_RE.test(value) ? value : undefined;
};

/** 갓 만들어진 DomainError에 correlationId를 찍는다. */
const withCorrelation = (err: DomainError, correlationId?: string): DomainError =>
  correlationId && !err.correlationId
    ? DomainError.fromSerialized({ ...err.toSerialized(), correlationId })
    : err;

export async function networkBoundary<T = unknown>(
  url: string | URL,
  opts: NetworkBoundaryOptions = {},
): Promise<T> {
  const { schema, timeoutMs = DEFAULT_TIMEOUT_MS, signal: externalSignal, ...init } = opts;

  // 사전 점검: 오프라인이 확실한 브라우저는 네트워크에 결코 도달하지 않는다 — 빠르고 구체적으로 실패한다.
  if (!isOnline()) {
    throw makeError({ code: "OFFLINE", details: null });
  }

  // 타임아웃 + 호출자 취소를 합성한다. 원인을 구별할 수 있도록 양쪽 참조를 모두 유지한다.
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = externalSignal
    ? AbortSignal.any([timeoutSignal, externalSignal])
    : timeoutSignal;

  // G8: 라우트 핸들러가 인바운드를 존중하도록 페이지 correlationId를 아웃바운드로 찍는다.
  // 호출자가 공급한 x-request-id(드묾)가 우선한다; 그렇지 않으면 심어 둔 쿠키 값을 끌어올린다.
  const requestHeaders = new Headers(init.headers);
  if (!requestHeaders.has(REQUEST_ID_HEADER)) {
    const outbound = outboundCorrelationId();
    if (outbound) requestHeaders.set(REQUEST_ID_HEADER, outbound);
  }

  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: requestHeaders, signal });
  } catch (cause) {
    // 1. 취소/타임아웃 — 하부 시그널 상태로 구별한다.
    if (timeoutSignal.aborted) {
      throw makeError({ code: "TIMEOUT", details: null, cause });
    }
    if (externalSignal?.aborted) {
      throw makeError({ code: "REQUEST_ABORTED", details: null, cause });
    }
    // 2. 전송 도중 연결이 끊겼을 수 있다 — liveness를 다시 확인한다.
    if (!isOnline()) {
      throw makeError({ code: "OFFLINE", details: null, cause });
    }
    // 3. 그 밖의 모든 전송 실패(DNS, TLS, CORS, TypeError: Failed to fetch…).
    throw makeError({ code: "NETWORK_ERROR", details: null, cause });
  }

  const correlationId = correlationFrom(res);

  // ── Non-ok: 서버 신뢰 경로가 FIRST, 상태 클래스 폴백이 SECOND. ──
  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = undefined;
    }

    // (a) 서버가 우리 프로토콜로 말했다 → 서버가 선택한 코드를 그대로 보존한다
    //     (FORBIDDEN / NOT_FOUND / VALIDATION / …). §8.4의 inline 분기를 도달 가능하게 만든다.
    if (isSerializedError(body)) {
      throw DomainError.fromSerialized(body satisfies SerializedError); // 서버가 설정했다면 이미 correlationId를 가지고 있다
    }

    // (b) 불투명한 에러 응답 → 상태 클래스로 매핑한다. 429는 Retry-After를 동반한다.
    const status = res.status;
    if (status === 429) {
      const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
      throw withCorrelation(
        makeError({
          code: "RATE_LIMITED",
          details: retryAfterMs !== undefined ? { retryAfterMs } : null,
        }),
        correlationId,
      );
    }
    // `code`를 구체적인 HTTP 리터럴로 좁혀, makeError가 엄격한 제네릭 아래에서
    // (전체 union이 아니라) 매칭되는 `{ status: number }` details 형태를 추론하도록 한다.
    const code: "HTTP_SERVER_ERROR" | "HTTP_CLIENT_ERROR" =
      status >= 500 ? "HTTP_SERVER_ERROR" : "HTTP_CLIENT_ERROR";
    throw withCorrelation(makeError({ code, details: { status } }), correlationId);
  }

  // ── Ok: 본문을 파싱하고 형태를 검증한다. ──
  let json: unknown;
  try {
    json = await res.json();
  } catch (cause) {
    throw withCorrelation(
      makeError({ code: "SCHEMA_MISMATCH", details: { endpoint: String(url) }, cause }),
      correlationId,
    );
  }

  if (!schema) {
    return json as T; // 스키마가 공급되지 않음 → 호출자가 형태를 단언한다(검사되지 않은 T 캐스트).
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw withCorrelation(
      makeError({ code: "SCHEMA_MISMATCH", details: { endpoint: String(url) }, cause: parsed.error }),
      correlationId,
    );
  }
  return parsed.data as T;
}
```
### 8.6 `retryable`를 load-bearing 하게 만들기 — `Retry-After`, QueryClient, 그리고 `withRetry`

r2는 모든 레지스트리 행에 `retryable`를 추가하고 `DomainError.retryable`를 노출했지만, 이를 소비하는 곳은 어디에도 없었다 — 게다가 TanStack Query는 기본값인 `retry: 3` 상태로 남겨 두어, `NOT_FOUND`/404와 그 밖의 재시도 불가능한 오류들을 조용히 재시도하고 있었다. r3은 "다시 시도할 것인가, 그리고 얼마나 기다릴 것인가"를 결정하는 세 지점에 이 플래그를 연결하며, 레지스트리는 SSOT(단일 진실 공급원)로 유지된다: 한 코드의 재시도 동작을 바꾸려면 행 하나를 편집하면 되고, 클라이언트 쿼리 계층, 네트워크 경계, 서버 DAL 재시도 헬퍼가 모두 그것을 따른다.

```ts
// error/retry-after.ts — 순수 파싱 + "재시도까지 얼마나?" 오라클 (클라이언트 + 서버 안전)
import { isDomainError } from "./app-error";

/**
 * HTTP `Retry-After` 헤더(RFC 9110 §10.2.3)를 밀리초로 파싱한다.
 *   - delta-seconds:  "120"
 *   - HTTP-date:      "Wed, 21 Oct 2025 07:28:00 GMT"
 * 음수가 아닌 ms 지연을 반환하거나, 없거나 파싱 불가하면 `undefined`를 반환한다. `now`는 테스트용으로 주입 가능.
 */
export const parseRetryAfter = (
  header: string | null | undefined,
  now: number = Date.now(),
): number | undefined => {
  if (header == null) return undefined;
  const trimmed = header.trim();
  if (trimmed === "") return undefined;
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;   // delta-seconds 먼저
  const dateMs = Date.parse(trimmed);                          // HTTP-date
  if (Number.isNaN(dateMs)) return undefined;
  return Math.max(0, dateMs - now);
};

/** 오류가 서버 제공 재시도 힌트(ms)를 지니고 있다면 추출한다. */
export const retryAfterHintFromError = (err: unknown): number | undefined => {
  if (!isDomainError(err)) return undefined;
  const details = err.details as { retryAfterMs?: unknown } | null | undefined;
  const hint = details?.retryAfterMs;
  return typeof hint === "number" && Number.isFinite(hint) && hint >= 0 ? hint : undefined;
};
```

```ts
// error/backoff.ts — 공유 지연 정책 (한 곳; 클라이언트 + 서버가 재사용)
import { retryAfterHintFromError } from "./retry-after";

export interface BackoffConfig {
  /** attempt 0에 대한 기본 지연, 단위 ms. */ readonly baseMs: number;
  /** "3600" 같은 Retry-After가 탭을 한 시간 동안 묶어두지 못하도록 하는 상한선. */ readonly maxMs: number;
}

export const DEFAULT_BACKOFF: BackoffConfig = { baseMs: 1_000, maxMs: 30_000 };

/** 풀-지터(full-jitter) 지수 백오프: [0, min(max, base*2^attempt)] 범위의 무작위값. */
export const exponentialBackoffWithJitter = (
  attempt: number,
  cfg: BackoffConfig = DEFAULT_BACKOFF,
  rand: () => number = Math.random,
): number => {
  const exp = Math.min(cfg.maxMs, cfg.baseMs * 2 ** attempt);
  return Math.round(rand() * exp);
};

/**
 * 재시도 지연 오라클. 서버가 보낸 Retry-After 힌트(오류에 실려 옴)는 계산된 백오프보다 우선하지만,
 * 여전히 `maxMs`로 클램프된다. 그렇지 않으면 풀-지터 백오프로 폴백한다.
 * `attempt`는 0부터 시작한다 (0 = 첫 재시도 전의 지연).
 */
export const computeRetryDelay = (
  attempt: number,
  err: unknown,
  cfg: BackoffConfig = DEFAULT_BACKOFF,
  rand: () => number = Math.random,
): number => {
  const hint = retryAfterHintFromError(err);
  if (hint !== undefined) return Math.min(hint, cfg.maxMs);
  return exponentialBackoffWithJitter(attempt, cfg, rand);
};
```

```ts
// error/query-client.ts  ('use client') — 공유 QueryClient 기본값.
// 읽기/쿼리 트랙에서 `retryable`를 load-bearing 하게 만들고, TanStack 기본값인
// retry:3이 404와 그 밖의 재시도 불가능한 코드를 재시도하지 못하게 막는다.
"use client";
import { QueryClient, type QueryClientConfig } from "@tanstack/react-query";
import { isDomainError } from "./app-error";
import { computeRetryDelay, DEFAULT_BACKOFF, type BackoffConfig } from "./backoff";

/** 재시도 가능한 오류에 대한 최대 재시도 ATTEMPTS 수 (count는 TanStack 기준 0부터 시작). */
export const MAX_QUERY_RETRIES = 3;

/**
 * 공유 재시도 술어. DomainError가 아닌 것은 재시도되지 않는다; DomainError는
 * `err.retryable`가 true이고 AND 시도 횟수 상한 미만일 때만 재시도된다.
 *   - NOT_FOUND (retryable:false) → false → 절대 재시도 안 됨 (기본 retry:3을 수정).
 *   - RATE_LIMITED / TIMEOUT / OFFLINE / NETWORK_ERROR / HTTP_SERVER_ERROR (retryable:true) → 재시도됨.
 */
export const shouldRetryQuery = (failureCount: number, error: unknown): boolean =>
  isDomainError(error) && error.retryable && failureCount < MAX_QUERY_RETRIES;

export const buildQueryClientConfig = (
  backoff: BackoffConfig = DEFAULT_BACKOFF,
): QueryClientConfig => ({
  defaultOptions: {
    queries: {
      retry: shouldRetryQuery,
      retryDelay: (attempt, error) => computeRetryDelay(attempt, error, backoff), // 0부터 시작하는 attempt
    },
    mutations: {
      // Mutation은 Result 트랙(§8.4)이다: 던져진 mutation 오류는 예기치 않은 것이다. 일시적 인프라 결함에 대해
      // retryable을 존중하되, 이중 제출을 피하기 위해 기본값은 ~0회 재시도로 둔다.
      retry: (failureCount, error) =>
        isDomainError(error) && error.retryable && error.code === "OFFLINE" && failureCount < 1,
      retryDelay: (attempt, error) => computeRetryDelay(attempt, error, backoff),
    },
  },
});

export const createAppQueryClient = (backoff?: BackoffConfig): QueryClient =>
  new QueryClient(buildQueryClientConfig(backoff));

/** 모듈-맵 별칭: 정본 `makeQueryClient` 팩토리 이름. */
export const makeQueryClient = createAppQueryClient;
```

```ts
// error/with-retry.ts  (server-only) — 재시도 가능한 DAL 호출에 대한 서버 측 재시도.
// DomainError.retryable(레지스트리 SSOT 플래그)와 RATE_LIMITED 오류에 실려 오는 서버 발송
// Retry-After 힌트를 존중한다. 재시도 불가능한 코드(NOT_FOUND, VALIDATION,
// FORBIDDEN, …)와 DomainError가 아닌 throw는 즉시 전파된다 — 절대 재시도 안 됨.
//
// 재시도 지연 오라클 + Retry-After 힌트 추출은 이 모듈이 자기완결적으로 유지되도록
// 여기에 인라인되어 있다 (React/TanStack 의존성 없음): 프레임워크 무관 지연 정책.
import "server-only";
import { isDomainError } from "./app-error";

export interface BackoffConfig {
  /** attempt 0에 대한 기본 지연, 단위 ms. */ readonly baseMs: number;
  /** "3600" 같은 Retry-After가 워커를 한 시간 동안 묶어두지 못하도록 하는 상한선. */ readonly maxMs: number;
}

export const DEFAULT_BACKOFF: BackoffConfig = { baseMs: 1_000, maxMs: 30_000 };

/** 오류가 서버 제공 재시도 힌트(ms)를 지니고 있다면 추출한다 (RATE_LIMITED). */
const retryAfterHintFromError = (err: unknown): number | undefined => {
  if (!isDomainError(err)) return undefined;
  const details = err.details as { retryAfterMs?: unknown } | null | undefined;
  const hint = details?.retryAfterMs;
  return typeof hint === "number" && Number.isFinite(hint) && hint >= 0 ? hint : undefined;
};

/** 풀-지터(full-jitter) 지수 백오프: [0, min(max, base*2^attempt)] 범위의 무작위값. */
const exponentialBackoffWithJitter = (
  attempt: number,
  cfg: BackoffConfig,
  rand: () => number,
): number => {
  const exp = Math.min(cfg.maxMs, cfg.baseMs * 2 ** attempt);
  return Math.round(rand() * exp);
};

/**
 * 재시도 지연 오라클. 서버가 보낸 Retry-After 힌트(오류에 실려 옴)는 계산된 백오프보다 우선하지만,
 * 여전히 `maxMs`로 클램프된다. 그렇지 않으면 풀-지터 백오프로 폴백한다.
 * `attempt`는 0부터 시작한다 (0 = 첫 재시도 전의 지연).
 */
const computeRetryDelay = (
  attempt: number,
  err: unknown,
  cfg: BackoffConfig,
  rand: () => number,
): number => {
  const hint = retryAfterHintFromError(err);
  if (hint !== undefined) return Math.min(hint, cfg.maxMs);
  return exponentialBackoffWithJitter(attempt, cfg, rand);
};

export interface WithRetryOptions {
  /** 초기 호출 이후의 최대 재시도 ATTEMPTS 수. 기본값 3. */ readonly maxRetries?: number;
  readonly backoff?: BackoffConfig;
  readonly sleep?: (ms: number) => Promise<void>; // 테스트용으로 주입 가능
  readonly rand?: () => number; // 테스트용 주입 가능 지터
}

const realSleep = (ms: number): Promise<void> => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 던져진 오류가 재시도 가능한 DomainError인 동안 서버 측 비동기 호출을 재시도한다.
 * 재시도 불가능한 코드(NOT_FOUND, VALIDATION, FORBIDDEN, …)는 즉시 throw 한다 — 절대 재시도 안 됨.
 * RATE_LIMITED 오류의 Retry-After 힌트는 computeRetryDelay가 존중한다.
 *   사용법: const doc = await withRetry(() => fetchUpstreamDoc(id));
 */
export const withRetry = async <T>(
  fn: () => Promise<T>,
  opts: WithRetryOptions = {},
): Promise<T> => {
  const { maxRetries = 3, backoff = DEFAULT_BACKOFF, sleep = realSleep, rand = Math.random } = opts;
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      const canRetry = isDomainError(error) && error.retryable && attempt < maxRetries;
      if (!canRetry) throw error;
      await sleep(computeRetryDelay(attempt, error, backoff, rand));
      attempt += 1;
    }
  }
};
```

**404 수정을, 정확히 진술한다.** 공유 술어는 `isDomainError(err) && err.retryable && count < N`이다. `NOT_FOUND`는 그 레지스트리 행에서 `retryable: false`로 해석되므로, 술어는 `false`로 단락(short-circuit)되어 쿼리는 **0**회 재시도된다 — TanStack의 기본값 3을 대체한다. 비-`DomainError` throw(가공되지 않은 버그)도 재시도되지 않는다. `withRetry`는 동일한 가드를 적용하므로, DAL 호출에서 던져진 재시도 불가능한 코드는 즉시 전파된다. 클라이언트의 `QueryClient`와 서버의 `withRetry`는 동일한 oracle로부터 지연 시간을 계산하므로, 서버의 `Retry-After` 힌트는 RSC 경계 양쪽에서 동일하게 백오프를 누르고 `maxMs`로 클램프된다. `query-client.ts`는 `'use client'`이고 `with-retry.ts`는 `server-only`이다. 클라이언트 측은 프레임워크에 무관한 `backoff.ts`를 import 하는 반면, `with-retry.ts`는 동일한 지연 정책(같은 `computeRetryDelay` + `retryAfterHintFromError`)을 인라인하여 React/TanStack 의존성을 전혀 지니지 않는다.


---
## 9. Correlation ID 전략

**요청당 하나의 ID를 가장 이른 서버 접점 — 프록시 경계(Node.js 런타임) — 에서 생성하고, 모든 곳으로 전파한다.**

> **Next 16 관점.** 과거 `middleware.ts` 였던 것은 이제 `proxy.ts` 이며, `export function proxy`(동기 또는 비동기)를 export 하고, Edge 가 아닌 **Node.js 런타임**에서 실행된다. CDN/엣지 발급도 없고 Edge 런타임 제약도 없다: `crypto.randomUUID()`, `Headers`, `NextResponse` 는 모두 Node 글로벌/표준 API 이며 `proxy` 안에서 유효하다. 앱당 `proxy.ts` 는 하나만 허용되므로, 이미 그곳에서 세션 갱신을 수행하고 있다면(`apps/backoffice/proxy.ts` 가 그렇듯이) 두 번째 파일을 추가하지 말고 correlation 로직을 기존 `proxy` 함수에 **컴포즈**하라.

1. **생성(프록시 경계, Node 런타임).** 인바운드 `x-request-id`(상위 로드 밸런서/게이트웨이에서 온 것)가 존재하고 형식이 올바르면 이를 존중하고, 그렇지 않으면 `crypto.randomUUID()` 로 UUIDv4 를 발급한다.

```ts
// proxy.ts — 프록시 경계 (Node.js 런타임), app/ 옆에 위치한다 (§9).
// 이것은 런타임 전용 파일명이다: 런타임에 프레임워크가 `proxy` 를 호출한다; 이
// 모듈의 목적상 이것은 단지 export 된 함수일 뿐이다. x-request-id 를 발급(또는
// 형식이 올바른 인바운드 값을 존중)하고, 이를 인바운드 요청 헤더로 전달하여 RSC/
// DAL/actions 가 `await headers()` 로 읽을 수 있게 하며, observability 를 위해 응답에
// 에코하고, 비-httpOnly 쿠키로 클라이언트를 시드한다. `crypto.randomUUID`,
// `Headers`, `NextResponse` 는 여기 Node.js 런타임에서 모두 유효하다.

import { NextResponse, type NextRequest } from "next/server";

const CORRELATION_HEADER = "x-request-id";
const CORRELATION_COOKIE = "x-correlation-id";
const ID_RE = /^[\w-]{8,64}$/;

export function proxy(req: NextRequest): NextResponse {
  // 1. 형식이 올바른 인바운드 id(상위 LB/게이트웨이에서 온 것)를 존중한다; 아니면 발급한다.
  const incoming = req.headers.get(CORRELATION_HEADER);
  const correlationId =
    incoming && ID_RE.test(incoming) ? incoming : crypto.randomUUID();

  // 2. 인바운드 헤더를 복제하고 id 를 설정하여 RSC/DAL/actions 가 `await headers()` 로
  //    이를 볼 수 있게 한다. request.headers 를 NextResponse.next 에 전달하면 앱이 이
  //    요청에서 보는 헤더를 재작성한다 — 서브 요청을 생성하지 않는다.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set(CORRELATION_HEADER, correlationId);

  const res = NextResponse.next({ request: { headers: requestHeaders } });

  // 3. 응답에 에코(observability) + 비-httpOnly 쿠키(클라이언트 시드).
  res.headers.set(CORRELATION_HEADER, correlationId);
  res.cookies.set(CORRELATION_COOKIE, correlationId, {
    httpOnly: false, // Reporter 컨텍스트 시드를 위해 클라이언트 JS 가 읽을 수 있어야 함
    sameSite: "lax",
    path: "/",
  });

  return res;
}

// `config` 는 여전히 proxy.ts 하에서 프레임워크가 경로 매칭을 위해 읽는 export 다.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
```

> 이미 `proxy` 에서 세션 갱신을 수행하고 있다면(백오피스가 그렇듯이) **컴포즈**하라 — 두 번째 프록시 파일을 추가하지 마라(앱당 `proxy.ts` 는 하나만 허용된다). `x-request-id` 를 발급/존중하고, 인바운드 헤더 집합을 구성한 다음, `updateSession(req)` 이 `NextResponse` 를 생성하게 하고, 반환하기 전에 그 위에 에코 헤더와 비-`httpOnly` 쿠키를 설정하라. 그 컴포즈된 경로에서 id 를 **인바운드** 헤더로도 전달하려면, `updateSession` 이 자신의 응답을 `NextResponse.next({ request: { headers: requestHeaders } })` 로부터 구성해야 한다.

2. **서버 전파.** 프록시는 `NextResponse.next({ request: { headers } })` 를 사용하여 id 를 **인바운드 요청 헤더**로 전달한다 — 이는 앱이 현재 요청에서 보는 헤더를 재작성하는 지원되는 메커니즘이며, 서브 요청이 아니고 추가 왕복도 발생시키지 않는다. RSC/DAL/액션은 `await headers()`(`x-request-id`)로 이를 읽고 요청별 `TelemetryContext` 에 구워 넣는다(`getRequestCorrelationId()` 를 통해, §7.1a). 모든 서버 로그 라인(콘솔 reporter)과 모든 `Sentry.setTag("correlationId", …)` 가 이를 사용한다. 액션이 `Failure` 를 반환하면 id 는 이미 `ClientSerializedError.correlationId` 에 실려 있으므로, *오류와 함께* 클라이언트로 건너간다.

```ts
// error/correlation.ts — §9 step 2/3 을 위한 단일 리더 (Node 런타임).
import "server-only";
import { headers } from "next/headers";

const CORRELATION_HEADER = "x-request-id";

/** 프록시가 인바운드 요청에 주입한 correlation id 를 읽는다. */
export async function getCorrelationId(): Promise<string> {
  const h = await headers();
  return h.get(CORRELATION_HEADER) ?? crypto.randomUUID();
}
```

> §7.1a 의 요청별 핸들러 구성은 `getRequestCorrelationId()`(이 리더의 `cache()` 처리된 변형)를 사용하므로 id 는 요청당 한 번 공유된다.

3. **서버→클라이언트 인계.** 프록시는 **비-`httpOnly` 쿠키**(`x-correlation-id`)를 설정하고 id 를 **아웃바운드 응답 헤더**에 에코한다. 그 쿠키(또는 루트 레이아웃이 `<ErrorHandlerInit correlationId={…} />` 로 렌더링한 인라인 값)는 클라이언트 싱글톤을 시드한다; `initHandleError` 가 이를 `Reporter.setContext` 로 푸시하므로, 클라이언트 Sentry 이벤트는 그 페이지를 생성한 서버 요청과 동일한 id 를 지닌다. 쿠키는 정확히 클라이언트 JS 가 읽을 수 있도록 비-`httpOnly` 로 유지되어야 한다.

   결정적으로, 클라이언트는 이 id 를 자신의 텔레메트리를 위해 단지 *지니고만* 있는 것이 아니라 — 이를 **다시 내보낸다**. §8.5(네트워크 경계)에 따라, 클라이언트 `fetch` 는 페이지의 `x-correlation-id` 를 아웃바운드 `x-request-id` 헤더로 부착한다. 이것은 **CSR-신규-발급 갭(CSR-mint-fresh gap)** 을 닫는다: 이것이 없으면, 브라우저에서 시작된 요청(라우트 핸들러 호출, 동일 출처 API 히트)은 인바운드 id 없이 프록시에 도달하여 *새로운* id 를 발급하게 되어, 그 새 요청을 그것을 촉발한 페이지 세션으로부터 끊어낸다. 페이지 id 를 아웃바운드로 에코함으로써, 프록시가 받는 모든 클라이언트 시작 요청은 이미 형식이 올바른 `x-request-id` 를 지니므로, 프록시는 발급 대신 이를 존중한다(1단계) — 그리고 페이지 렌더링부터 이후 클라이언트 fetch 까지 전체 체인이 단일 id 아래로 꿰매진다.

4. **이것이 안착하는 곳:** `x-request-id` **인바운드** 헤더(`await headers()` 를 통한 RSC/DAL/액션) · `x-request-id` **아웃바운드** 응답 헤더(네트워크 탭 / curl) · `x-correlation-id` 쿠키(클라이언트 시드) · **클라이언트 시작 `fetch` 상의** `x-request-id`(§8.5 에 따라 다시 아웃바운드로 보내진 페이지 id 로, 프록시가 이를 존중하므로 클라이언트 요청은 새로 발급하는 대신 페이지 id 를 상속한다) · 서버 로그(콘솔 reporter) · Sentry 태그 + `ClientSerializedError` 상 · 지원 대면용 `digest` 와 서버 측에서 상호 연관됨. 하나의 id 가 모든 싱크에 걸쳐 전체 요청 수명 주기를 꿰맨다.


---
## 10. 테스트 전략

| 계층 | 무엇을 테스트하는가 | 방법 |
|---|---|---|
| **레지스트리 불변식** | 모든 `ErrorCode`가 `schema` 항목을 가진다(`RATE_LIMITED` 포함); 모든 `httpStatus`가 유효하다; `kind`/`severity`/`present`/`log`이 각자의 유니온 멤버이다; `isExpectedCode(code) === (meta.kind === "business")`가 의도 축을 도출한다; `DETAILS_ALLOWLIST`(§5.2)가 모든 코드에 대해 키가 부여되어 있다(fail-closed) AND — G1 불변식 — 모든 배열-규칙 키가 해당 코드의 Zod 스키마에 실제로 존재하는 키이며(`AllowedKeys<C>` + 런타임 가드를 통해 컴파일 강제), 모든 `z.null()` 스키마 코드는 null/빈 규칙을 가진다(누출할 것이 없음); `RATE_LIMITED.retryAfterMs`가 허용 목록에 등재되어 있다 | `Object.keys(DEFAULT_ERROR_REGISTRY)`(15개 코드)를 순회하는 단일 테이블 기반 유닛 테스트 — 스키마, 유니온에 유효한 `kind`/`present`, 또는 허용 목록 결정 없이 코드가 추가되면 CI를 실패시킨다. r5 present/kind 매트릭스를 정확히 단언한다(예: `VALIDATION` → `business`/`inline`, `REQUEST_ABORTED` → `operational`/`silent`). |
| **활성 레지스트리 / `resolvePolicy`** | `getActiveErrorRegistry()`는 어떤 스코프 바깥에서도 DEFAULT를 반환한다; `setActiveErrorRegistry`(클라이언트)는 싱글톤을 바인딩한다; `runWithErrorRegistry`(서버)는 호출별로 스코프를 부여한다; `resolvePolicy`는 인스턴스 오버라이드 + `?? UNKNOWN_CLIENT_ERROR` 폴백을 준수한다; 게터와 `handleError`가 일치한다 | 치환된 레지스트리를 바인딩한다; `err.httpStatus`와 `handleError(...).policy.httpStatus`가 일치함을 단언한다. `setActiveErrorRegistry`는 서버에서 throw한다. |
| **`makeError` / `construct` 검증** | 잘못된 `details` → 런타임이 선택하는 `UNKNOWN_*` 폴백; 올바른 `details`는 통과; 단일 `construct()` 캐스트가 `noUncheckedIndexedAccess` 아래에서 컴파일된다 | `getRuntime()`을 모킹하여 `"server"`/`"client"` 양쪽을 반환하게 하는 유닛 테스트. |
| **직렬화 재수화(rehydration)** | `normalize(err.toSerialized())`이 `normalize(err)`와 깊은 동등(deep-equal)이다; `digest`/`correlationId`가 보존된다; 손상된 페이로드 → `UNKNOWN_*`이지만 `correlationId`+`digest`는 유지한다; 와이어로 전달된 `correlationId`가 우선한다; 알려진 Error 형태가 매핑된다(`AbortError`→`REQUEST_ABORTED`, `TimeoutError`→`TIMEOUT`); 분기 순서(`isSerializedError`보다 `isDomainError`가 먼저) | `rehydration.test.ts`(아래 스니펫). |
| **`handleError` 부수 효과(r5 단계 게이팅)** | 고정된 팬아웃 순서: (1) `reporter.report` — 단, 해석된 `log`이 `"none"`인 경우는 제외; (2) `notifier.notify` — 항상(알림 게이트는 notifier 내부에 존재); (3) `presenter.present` — `present`이 `"toast"`/`"alert"`인 경우에 한해서만(`inline`/`silent`/`redirect`/`page`은 절대 도달하지 않음); (4) `reporter.breadcrumb` — T1 영향(impact) breadcrumb(브레드크럼), `present !== "silent"`일 때마다 기록되며 `log`과는 독립적이다. 유효한 `policy`(`present`를 담고, `kind`에서 도출된 `expected`/`isOperational`을 포함)를 가진 `ResolvedAppError`를 반환한다 | **스파이** `Reporter`/`Presenter`/`Notifier`를 주입한다. 호출 횟수, `present()`-이전-`breadcrumb()` 순서 불변식, 그리고 반환된 `policy`를 단언한다. |
| **영향(impact) breadcrumb(브레드크럼)(T1, r5 게이팅 변경)** | 세 싱크 이후, `handleError`는 재포착 없이 `reporter.breadcrumb(error, surface, ctx)`를 통해 사용자에게 보이는 영향(impact)을 기록한다: `ctx.correlationId`로 키가 부여되고, `surface` === 사용자가 경험한 해석된 `PresentAction`이며, `log === "none"`일 때도 발화하고, `"silent"`일 때만 건너뛴다. 이것이 과거의 중복-로깅 혼동에 대한 해소이다 — fault는 한 번 포착되고(`report`에 의해), 사용자-영향은 별도로 기록된다(`breadcrumb`에 의해) | `Reporter`를 스파이한다; `breadcrumb`이 `inline`/`toast`/`alert`/`redirect`/`page`에 대해 해석된 surface로 한 번 발화하고, `silent`에 대해서는 건너뛰며(레지스트리 `REQUEST_ABORTED` 및 호출별 `present:"silent"` 오버라이드), `log:"none"` 아래에서도 여전히 발화함을 단언한다. |
| **컴포지트(dead-man-switch(데드맨 스위치))** | 하나의 throw하는 reporter가 나머지를 망가뜨리지 않는다; 어떤 예외도 빠져나가지 않는다(`report`, `breadcrumb`, `setUser`, `setContext` 모두 가드됨); 싱크별 실패 카운터가 증가한다; 누적 `totalFailures`는 중간의 성공으로 결코 리셋되지 않는다; 레이트 제한된 최후의 수단이 stderr로 방출된다; `health()`가 실패를 반영한다(방어적 복사됨) | 스파이와 함께 `throw`하는 페이크를 구성한다; 스파이가 여전히 호출되고 `health().failures` / `totalFailures`가 증가함을 단언한다. 새로운 `breadcrumb()` 팬아웃도 동일하게 가드된다. |
| **Notifier / AlertPolicy** | 임계값 이상에서만 페이저된다; 미만에서는 no-op; 억제된 런타임은 결코 페이저되지 않는다; `notify`는 결코 throw하지 않는다; fire-and-forget(논블로킹) | 스파이 `Notifier` + 스파이 `PagerTransport`; `policyGatedNotifier(thresholdAlertPolicy())`를 통한 `shouldPage` 게이팅을 단언한다; throw하는 transport가 표면화되지 않음을 단언한다. |
| **페이저 억제기(G7)** | `createPagerNotifier`는 윈도우당 `dedupKey`(`${code}:${route}`)별로 한 번 페이저하고 동일 인시던트의 refresh/retry 폭주를 억제한다; 윈도우가 경과하면 새 페이지가 허용된다; 서로 다른 인시던트(다른 route)는 둘 다 페이저한다; transport 실패는 삼켜진다(알림은 결코 앱으로 throw하지 않는다); `webhookPagerTransport`는 `AbortSignal.timeout(5000)`으로 POST하며 `dedup_key`+`severity`를 담는다 | 기록형 `PagerTransport` + 페이크 `now`를 주입한다; `fetch`를 모킹하고 경계가 지어진 아웃바운드 호출을 단언한다. |
| **Sentry 강화** | `beforeSend`는 `email`/쿠키를 떨어뜨리고, PII 키 + 토큰-형태 문자열을 마스킹한다(깊이 제한됨); `fingerprint:[code]`; 브라우저 경계 토큰 버킷이 `window.onerror` 폭주를 스로틀링하되 드롭을 기록한다; 스로틀-드롭은 dead-man-switch(데드맨 스위치)에 공급되지 않는다 | 조작된 이벤트에 대한 유닛 `sentryBeforeSend`; `ctx.route="window.onerror"`로 용량을 초과하여 `report`를 구동한다. |
| **직렬화기 강제(누출 방지)** | `toClientSerialized`는 `message`를 생략한다; `VALIDATION.fieldErrors`는 통과한다; `RATE_LIMITED.retryAfterMs`는 허용 목록에 등재되어 클라이언트로 건너간다(G1 — 카운트다운 문구가 보간하는 공개 Retry-After); `SCHEMA_MISMATCH.endpoint`/`FORBIDDEN.requiredRole`/`NOT_FOUND.resource`/`HTTP_*.status`는 떨어진다; 허용 목록에 없는 형제 키는 얕게 제거된다; DTO는 JSON-안전이다(함수 없는 순수 객체); `toInternalSerialized`는 `message`를 유지한다 | 코드별로 키의 존재/부재를 단언한다; 클라이언트로 향하는 어떤 경로도 `.toSerialized(`를 호출하지 않음을 grep한다. |
| **`fieldErrorsFromError`(G12)** | `VALIDATION` `DomainError`에 대해 `error.details.fieldErrors`를 반환한다(항목이 없으면 빈 레코드, 결코 `null`이 아님); 그 외의 모든 코드와 비-`DomainError` 입력(형태만 갖춘 순수 객체 포함)에 대해서는 `null`을 반환한다 | `VALIDATION` 오류, `NOT_FOUND` 오류, 그리고 비-인스턴스 입력에 대한 유닛 테스트 `fieldErrorsFromError` — 이것이 쿼리-트랙 inline 분기에 공급된다. |
| **`safeServerAction`(RPC 뮤테이션)** | Track-1은 `Failure`를 반환한다(검증 + 의도한(expected)/business `DomainError`); Track-2는 `getRequestHandler()`를 통해 `{ present: "silent" }`로 보고한 다음 의도하지 않은 오류를 다시 throw한다; `redirect`/`notFound`는 손대지 않고 다시 throw한다; `await getRequestHandler()` | 페이크 액션을 전달한다; `handleServerError` 이전에 제어 흐름(프레임워크 인터럽트)이 단락(short-circuit)됨을, 그리고 보고가 `present:"silent"`(이름이 변경된, 진정으로 무음인 옵션)를 사용함을 단언한다. |
| **`safeFormAction`(폼 뮤테이션)** | FormData 다중값/File 강제 변환; 검증→`Failure`; 의도한(expected)/business→`Failure`(throw 아님); 의도하지 않음→보고(`{ present: "silent" }`)+재throw; 네 가지 인터럽트 모두 `rethrowControlFlow`를 통해 다시 throw됨; `(prevState, formData)` 인자 순서 | `FormData`로 구동한다; `useActionState` 조합 + `Result` 형태를 단언한다. |
| **요청별 핸들러 격리** | 두 개의 인터리브된 요청이 결코 `correlationId`/`user`를 누출하지 않는다; 반복된 `getRequestHandler()`는 메모이즈된 인스턴스를 반환한다; 모듈 수준 가변 안티패턴은 *실제로* 누출된다. 기저 프리미티브 — 서버 측 `runWithErrorRegistry`/`getActiveErrorRegistry` `AsyncLocalStorage` — 는 각 컨텍스트의 레지스트리를 모든 `await`에 걸쳐 교차 누출 없이 운반한다 | `AsyncLocalStorage`가 요청 스코프를 모델링한다; `Promise.all`로 두 개의 인터리브된 레지스트리(아래 스니펫). |
| **쿼리 경로(throw)** | `queryFn`이 `DomainError`를 throw한다; 의도한(expected)/business → inline으로 처리됨(`fieldErrorsFromError`가 필드별 렌더링에 공급); 의도하지 않음 → `throwOnError`가 에스컬레이션; `raise()`가 코드를 → 인터럽트로 매핑 | 코드별로 `raise()`를 유닛 테스트한다; throw하는 `queryFn`을 가진 `useQuery` 소비자를 컴포넌트 테스트한다. |
| **`networkBoundary`** | 각 분기 → 올바른 코드(OFFLINE/TIMEOUT/REQUEST_ABORTED/HTTP_*/RATE_LIMITED/SCHEMA_MISMATCH/NETWORK_ERROR); 서버 `isSerializedError` 본문이 status-class보다 먼저 보존된다; 429→RATE_LIMITED + Retry-After가 `details.retryAfterMs`로 파싱됨(delta-seconds AND HTTP-date); TIMEOUT-대-REQUEST_ABORTED는 어느 시그널이 abort했는지로 결정; 인바운드 `x-request-id`가 `correlationId`로 끌어올려짐; (G8) 아웃바운드 `x-request-id`는 클라이언트의 `x-correlation-id` 쿠키에서 스탬프됨(URL-디코딩, `ID_RE`-가드, 호출자 값이 우선) | `vi.useFakeTimers`, `fetch`/`navigator.onLine` 모킹, `AbortSignal.any`. |
| **재시도 정책** | `NOT_FOUND`은 0회 재시도; `RATE_LIMITED`은 expo+지터보다 Retry-After에서 도출된 지연(`maxMs`로 클램프됨)을 선호한다; 지터는 `maxMs`로 경계가 지어진다; `parseRetryAfter`는 delta-seconds AND HTTP-date를 처리한다; `withRetry`는 동일한 `retryable` 플래그와 Retry-After 힌트를 준수한다 | 주입된 `rand`/`sleep`/`now`로 `makeQueryClient` `retry`/`retryDelay` 및 `withRetry`를 구동한다. |
| **경계(컴포넌트) — `ErrorFallback`** | 핸들러 이펙트가 `handleError({log:"none"})`를 호출한다(중복 서버 보고 없음) — 렌더가 아니라 렌더-이펙트에서 키가 부여됨; `role="alert"` 컨테이너는 **마운트 시 포커스됨**(`tabIndex={-1}`); 리셋 전용 재시도는 `router.refresh()`를 호출한 다음 `reset()`을 호출한다(Next 15 RSC 재페치), `unstable_retry`가 선호됨; 재시도 어포던스는 해석된 `retryable`에 따라 **게이팅됨**(`VALIDATION`에는 숨김, `HTTP_SERVER_ERROR`에는 표시); 이펙트는 try/catch로 감싸져 클라이언트 싱글톤이 초기화되지 않았을 때 `global-error.tsx`가 **결코 throw하지 않는다**; `global-error.tsx`는 프로바이더 없는 번역기(`minimal`)를 사용한다; 실제 지역화된 문구가 렌더된다(원시 키가 결코 아님) | React Testing Library(jsdom); throw하는 자식 / `DomainError`로 렌더한다; 핸들러 스파이, 포커스, 게이트, refresh→reset 순서, 그리고 실제 핸들러에 대한 no-throw 경로를 단언한다. |
| **i18n 완전성** | 모든 `userMessageKey`가 공개 리졸버와 번역기 없는 경로를 통해 비어 있지 않은, 키가 아닌 문자열로 해석된다; `FALLBACK_MESSAGES`는 모든 `ErrorCode`에 대한 항목을 가지며 추가 키는 없다; `RATE_LIMITED` 카운트다운은 `{seconds}` 토큰을 담고 원시 토큰 누출 없이 보간한다(예: `5초 후 다시 시도해주세요.`); 호스트 `Translator`가 선호되지만 키-에코/빈 값/throw는 함께 배치된 폴백으로 격하된다(오늘은 단일 기본-로케일 열 — `en` 열 / 로케일별 분할은 §12 향후 확장이다) | 각 코드의 `FALLBACK_MESSAGES[code]` + `resolveErrorMessage`를 단언하는 `it.each(Object.keys(DEFAULT_ERROR_REGISTRY))`(아래 스니펫). |
| **`page` 에스컬레이션** | `useErrorHandler`는 매핑되지 않은 `page` 코드에 대해 정규화된 오류를 다시 throw한다; 매핑된 경우 내비게이션한다(`FORBIDDEN→/403`); `redirect`→`router.push("/login")` | 라우터를 스파이한다; 해석된 `policy.present`별로 push/throw를 단언한다. |
| **Correlation ID(프록시)** | 인바운드가 존재하면 준수하고, 아니면 새로 발급한다; 인바운드로 전달됨(`headers()`를 통해 읽을 수 있음), 응답 헤더 + non-httpOnly 쿠키에 에코됨; `runtime`은 결코 `"edge"`가 아니다 | `NextResponse.next({request:{headers}})`가 id를 운반함을 단언하는 `proxy` 유닛 테스트; E2E `/api` 라우트가 `x-request-id`를 왕복한다. |
| **E2E(Playwright)** | 401→로그인 리다이렉트, 403→forbidden 페이지, 404→not-found, 강제된 500→`digest` 참조를 가진 `error.tsx`; `retry`가 복구한다; 429→retry가 Retry-After를 준수한다 | 실제 내비게이션; 각 상태를 강제하기 위해 네트워크를 인터셉트한다. |

DI는 이 모든 것을 자명하게 만든다: 테스트는 페이크로부터 `HandleErrorDeps`를 구성한다 — **유닛 테스트에서는 어떤 벤더 SDK도 결코 로드되지 않는다**, 이것이 그 추상화에 대한 가장 강력한 논거이다. 현 상태의 스위트는 **17개 테스트 파일 / 324개 테스트, 0개 실패**이다(`tsc` 클린).

### 10.1 재수화(rehydration) 왕복(정체성의 실행 가능한 증명)

```ts
// error/__tests__/rehydration.test.ts
// §10.1 재수화(rehydration) 왕복 — 직렬화-안전 정체성.
//
// DomainError를 그 와이어 DTO를 통과시켜 다시 되돌리면 동등한
// DomainError가 나옴을 증명한다: 검증 오류(fieldErrors를 가진),
// NOT_FOUND, 그리고 서버 코드에 대해 normalize(err.toSerialized()) ≡ normalize(err)이며;
// fromSerialized가 code/correlationId/digest를 보존하고; toSerialized가 digest를
// 왕복하며; 순수 값은 서버에서 UNKNOWN_SERVER_ERROR로 매핑됨을
// (`window`가 스텁되면 UNKNOWN_CLIENT_ERROR). 모든 입력은
// makeError를 통해 만들어진다 — 단일 생성 경로.
import { afterEach, describe, expect, it, vi } from "vitest";

import { DomainError, isDomainError, type SerializedError } from "@/error/app-error";
import { makeError } from "@/error/make-error";
import { normalizeToDomainError } from "@/error/normalize";
import { getRuntime } from "@/error/runtime";

// 두 DomainError를 그 관찰 가능한, 직렬화-안정 표면에서 비교한다.
// (클래스 인스턴스에 대해 expect(err).toEqual(err2)는 의도적으로 피한다 —
// Error는 비결정적 스택을 운반하며; 와이어 계약은 toSerialized()이다.)
const wire = (e: DomainError): SerializedError => e.toSerialized();

describe("§10.1 rehydration round-trip — serialization-safe identity", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("VALIDATION (with fieldErrors): normalize(toSerialized) deep-equals normalize(original)", () => {
    const err = makeError({
      code: "VALIDATION",
      details: { fieldErrors: { email: ["required", "invalid"], name: ["required"] } },
      correlationId: "corr-validation",
    });

    const direct = normalizeToDomainError(err);
    const rehydrated = normalizeToDomainError(err.toSerialized());

    // 와이어를 가로지른 정체성: 두 경로 모두 동일한 관찰 가능 형태로 수렴한다.
    expect(wire(rehydrated)).toEqual(wire(direct));
    expect(rehydrated.code).toBe("VALIDATION");
    expect(rehydrated.details).toEqual({
      fieldErrors: { email: ["required", "invalid"], name: ["required"] },
    });
    expect(rehydrated.correlationId).toBe("corr-validation");
  });

  it("NOT_FOUND: normalize(toSerialized) deep-equals normalize(original)", () => {
    const err = makeError({
      code: "NOT_FOUND",
      details: { resource: "user" },
      correlationId: "corr-nf",
    });

    const direct = normalizeToDomainError(err);
    const rehydrated = normalizeToDomainError(err.toSerialized());

    expect(wire(rehydrated)).toEqual(wire(direct));
    expect(rehydrated.code).toBe("NOT_FOUND");
    expect(rehydrated.details).toEqual({ resource: "user" });
  });

  it("a server code (HTTP_SERVER_ERROR): normalize(toSerialized) deep-equals normalize(original)", () => {
    const err = makeError({
      code: "HTTP_SERVER_ERROR",
      details: { status: 500 },
      correlationId: "corr-500",
    });

    const direct = normalizeToDomainError(err);
    const rehydrated = normalizeToDomainError(err.toSerialized());

    expect(wire(rehydrated)).toEqual(wire(direct));
    expect(rehydrated.code).toBe("HTTP_SERVER_ERROR");
    expect(rehydrated.details).toEqual({ status: 500 });
  });

  it("the wire DTO survives a real JSON round-trip (structural identity, no ghost keys)", () => {
    const err = makeError({
      code: "VALIDATION",
      details: { fieldErrors: { email: ["required"] } },
      correlationId: "corr-json",
    });

    const overWire: SerializedError = JSON.parse(JSON.stringify(err.toSerialized()));
    const rehydrated = normalizeToDomainError(overWire);

    expect(rehydrated.toSerialized()).toEqual(err.toSerialized());
    // omit-undefined 계약: 부재 시 correlationId/digest 유령 키가 없다.
    const bare = makeError({ code: "NOT_FOUND", details: null }).toSerialized();
    expect(Object.keys(bare).sort()).toEqual(["code", "details", "message"]);
    expect("correlationId" in bare).toBe(false);
    expect("digest" in bare).toBe(false);
  });

  it("DomainError.fromSerialized preserves code, correlationId and digest", () => {
    const payload: SerializedError = {
      code: "NOT_FOUND",
      message: "no such row",
      details: { resource: "order" },
      correlationId: "corr-from",
      digest: "digest-abc123",
    };

    const rebuilt = DomainError.fromSerialized(payload);

    expect(isDomainError(rebuilt)).toBe(true);
    expect(rebuilt.code).toBe("NOT_FOUND");
    expect(rebuilt.details).toEqual({ resource: "order" });
    expect(rebuilt.correlationId).toBe("corr-from");
    expect(rebuilt.digest).toBe("digest-abc123");
    expect(rebuilt.message).toBe("no such row");
  });

  it("toSerialized round-trips the digest (set via makeError, recovered via fromSerialized)", () => {
    const err = makeError({
      code: "HTTP_SERVER_ERROR",
      details: { status: 503 },
      digest: "rsc-digest-42",
      correlationId: "corr-digest",
    });

    expect(err.digest).toBe("rsc-digest-42");

    const serialized = err.toSerialized();
    expect(serialized.digest).toBe("rsc-digest-42");

    const rebuilt = DomainError.fromSerialized(serialized);
    expect(rebuilt.digest).toBe("rsc-digest-42");
    expect(rebuilt.correlationId).toBe("corr-digest");
    // digest는 normalize를 통한 완전한 와이어 여정도 살아남는다.
    const viaNormalize = normalizeToDomainError(JSON.parse(JSON.stringify(serialized)));
    expect(viaNormalize.digest).toBe("rsc-digest-42");
  });

  it("a corrupt/forged details payload falls back to UNKNOWN but still carries the support trail", () => {
    // 코드별 스키마를 위반하는 details (NOT_FOUND는 number가 아니라 object|null을 원한다).
    const forged: SerializedError = {
      code: "NOT_FOUND",
      message: "tampered",
      details: 12345,
      correlationId: "corr-forged",
      digest: "digest-forged",
    };

    const rebuilt = DomainError.fromSerialized(forged);

    // node 런타임 → UNKNOWN_SERVER_ERROR, 하지만 correlationId + digest는 살아남는다.
    expect(rebuilt.code).toBe("UNKNOWN_SERVER_ERROR");
    expect(rebuilt.correlationId).toBe("corr-forged");
    expect(rebuilt.digest).toBe("digest-forged");
  });

  it("a plain Error → UNKNOWN_SERVER_ERROR in node, stamping the supplied correlationId", () => {
    expect(getRuntime()).toBe("server");

    const rebuilt = normalizeToDomainError(new Error("boom"), "fallback msg", "corr-plain");

    expect(rebuilt.code).toBe("UNKNOWN_SERVER_ERROR");
    expect(rebuilt.correlationId).toBe("corr-plain");
    expect(rebuilt.message).toBe("fallback msg");
  });

  it("a plain Error → UNKNOWN_CLIENT_ERROR when window is stubbed (client runtime)", () => {
    vi.stubGlobal("window", {});
    expect(getRuntime()).toBe("client");

    const rebuilt = normalizeToDomainError(new Error("boom"));

    expect(rebuilt.code).toBe("UNKNOWN_CLIENT_ERROR");
  });

  it("an already-DomainError input is returned and stamped with the ctx correlationId when absent", () => {
    const err = makeError({ code: "NOT_FOUND", details: null });
    expect(err.correlationId).toBeUndefined();

    // 분기 1: 인스턴스가 통과한다. correlationId 부재 → ctx에서 스탬프됨.
    const stamped = normalizeToDomainError(err, undefined, "ctx-corr");
    expect(isDomainError(stamped)).toBe(true);
    expect(stamped.code).toBe("NOT_FOUND");
    expect(stamped.correlationId).toBe("ctx-corr");

    // 이미 correlationId를 운반하는 인스턴스는 손대지 않고 반환된다
    // (동일 참조 — 재빌드 없음).
    const withId = makeError({ code: "NOT_FOUND", details: null, correlationId: "own-corr" });
    const passedThrough = normalizeToDomainError(withId, undefined, "ctx-corr");
    expect(passedThrough).toBe(withId);
    expect(passedThrough.correlationId).toBe("own-corr");
  });
});
```
### 10.2 요청별 격리 (요청 간 누출 없음)

전체 `getRequestHandler` + `next/headers()` 경로는 실제 Next 요청 스코프를 필요로 하며 E2E에서 검증된다. 아래 단위 테스트는 그 경로가 의존하는 기반 `AsyncLocalStorage` 보장을 입증한다 — 각 `runWithErrorRegistry` 스코프는 모든 `await`를 가로질러 자신만의 레지스트리를 누출 없이 운반하며, 클라이언트 전용 `setActiveErrorRegistry`는 요청 간 누출을 유발하기 때문에 정확히 그 이유로 서버 측에서 거부된다.

```ts
// error/__tests__/per-request-isolation.test.ts
// §10.2 요청별 격리 (요청 간 누출 없음).
//
// 요청 핸들러를 떠받치는 실제 격리 프리미티브를 테스트한다:
// active-registry의 서버 측 AsyncLocalStorage 스코프(runWithErrorRegistry /
// getActiveErrorRegistry). 전체 getRequestHandler + next/headers() 경로는
// 실제 Next 요청 스코프를 필요로 하며 E2E에서 검증된다; 여기서는 그 경로가
// 의존하는 기반 ALS 보장을 입증한다.
//
// *.test.ts에 대한 vitest의 기본 환경은 "node"이므로(vitest.config.ts 참조),
// `typeof window === "undefined"`가 true => getRuntime() === "server" =>
// getActiveErrorRegistry()는 AsyncLocalStorage 저장소를 읽는다. window 스터빙은
// 필요 없다; 서버 분기가 살아있음을 먼저 단언한다.
import { describe, it, expect, beforeEach } from "vitest";
import {
  getActiveErrorRegistry,
  setActiveErrorRegistry,
  runWithErrorRegistry,
} from "@/error/active-registry";
import { DEFAULT_ERROR_REGISTRY, type ErrorRegistry } from "@/error/registry";
import { getRuntime } from "@/error/runtime";
import { DomainError } from "@/error/app-error";

// DEFAULT를 복제하고 단일 코드의 관측 가능한 필드 하나(httpStatus)를 다시 찍어
// 구별되는 레지스트리를 만든다. 식별자 AND 값이 DEFAULT와 다르므로,
// 누출은 참조(===)와 동작(httpStatus) 양쪽으로 감지 가능하다.
const makeRegistry = (validationHttpStatus: number): ErrorRegistry =>
  ({
    ...DEFAULT_ERROR_REGISTRY,
    VALIDATION: { ...DEFAULT_ERROR_REGISTRY.VALIDATION, httpStatus: validationHttpStatus as never },
  }) as ErrorRegistry;

const REG_A = makeRegistry(418); // 요청 A의 카탈로그
const REG_B = makeRegistry(451); // 요청 B의 카탈로그

describe("§10.2 active-registry AsyncLocalStorage per-request isolation", () => {
  beforeEach(() => {
    // 각 테스트는 주변(ambient) 스코프 없이 시작한다. 서버에서는 setActiveErrorRegistry를
    // 절대 호출하지 않으므로(설계상 throw — 아래에서 검증), 유일한 가변
    // 상태는 지연 생성되는 ALS뿐이며, 이는 어떤 run() 밖에서도 비어 있다.
    expect(getRuntime()).toBe("server");
  });

  it("resolves to DEFAULT_ERROR_REGISTRY outside any runWithErrorRegistry scope", () => {
    expect(getActiveErrorRegistry()).toBe(DEFAULT_ERROR_REGISTRY);
  });

  it("inside a scope returns THAT scope's registry; reverts to DEFAULT after", () => {
    const seen = runWithErrorRegistry(REG_A, () => getActiveErrorRegistry());
    expect(seen).toBe(REG_A);
    // work()가 반환되면 스코프는 동기적으로 닫힌다 => DEFAULT로 복귀.
    expect(getActiveErrorRegistry()).toBe(DEFAULT_ERROR_REGISTRY);
  });

  it("nested scopes shadow then restore the enclosing registry (LIFO)", () => {
    runWithErrorRegistry(REG_A, () => {
      expect(getActiveErrorRegistry()).toBe(REG_A);
      runWithErrorRegistry(REG_B, () => {
        expect(getActiveErrorRegistry()).toBe(REG_B);
      });
      // 내부 스코프가 팝됨 — A가 복원되며, B나 DEFAULT로 누출되지 않는다.
      expect(getActiveErrorRegistry()).toBe(REG_A);
    });
    expect(getActiveErrorRegistry()).toBe(DEFAULT_ERROR_REGISTRY);
  });

  it("INTERLEAVED async contexts (different registries) never cross-talk", async () => {
    // 두 개의 동시 '요청'. 각각은 await된 타이머를 통해 매 단계마다 이벤트 루프에
    // 제어를 양보하여 스케줄러가 이들을 인터리브하도록 강제한다. ALS는 모든
    // await 경계를 가로질러 각 컨텍스트의 레지스트리를 누출 없이 운반해야 한다.
    const tick = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

    const request = async (reg: ErrorRegistry, expectedStatus: number): Promise<number[]> =>
      runWithErrorRegistry(reg, async () => {
        const reads: number[] = [];
        for (let i = 0; i < 4; i++) {
          // A와 B를 어긋나게 하여 그들의 await가 번갈아 가며 해소되도록 한다.
          await tick(reg === REG_A ? 1 : 2);
          const active = getActiveErrorRegistry();
          // 참조 식별자가 await를 가로질러 유지되어야 한다.
          expect(active).toBe(reg);
          // 그리고 DomainError 게터는 THIS 컨텍스트의 카탈로그에 대해 해소되어야 하며,
          // 이는 바인딩이 원시 게터뿐 아니라 소비자에게까지 도달함을 입증한다.
          const err = new DomainError({ code: "VALIDATION", details: { fieldErrors: {} } });
          expect(err.httpStatus).toBe(expectedStatus);
          reads.push(err.httpStatus);
        }
        return reads;
      });

    const [a, b] = await Promise.all([request(REG_A, 418), request(REG_B, 451)]);
    // A 내부의 모든 읽기는 418을 봤고; B 내부의 모든 읽기는 451을 봤다 — 인터리빙 누출 없음.
    expect(a).toEqual([418, 418, 418, 418]);
    expect(b).toEqual([451, 451, 451, 451]);
    // 둘 다 정착된 후, 주변 스코프는 다시 비어 있다.
    expect(getActiveErrorRegistry()).toBe(DEFAULT_ERROR_REGISTRY);
  });

  it("a context that runs entirely WHILE another is suspended keeps its own registry", async () => {
    // A를 시작하고, 진행 중에 중단시킨 뒤, 그 틈에서 B를 완전히 완료까지 실행하고,
    // 그런 다음 A를 재개한다. A는 재개 시에도 여전히 REG_A를 읽어야 한다(B의 스코프에서 누출 없음).
    let resumeA!: () => void;
    const aSuspended = new Promise<void>((res) => {
      resumeA = res;
    });

    const aResult: { before?: ErrorRegistry; after?: ErrorRegistry } = {};
    const aPromise = runWithErrorRegistry(REG_A, async () => {
      aResult.before = getActiveErrorRegistry();
      await aSuspended; // A의 연속(continuation)을 정차시킨다
      aResult.after = getActiveErrorRegistry();
    });

    // A가 정차된 동안, B는 자신의 스코프에서 시작부터 끝까지 실행된다.
    const bSaw = await runWithErrorRegistry(REG_B, async () => {
      await Promise.resolve();
      return getActiveErrorRegistry();
    });
    expect(bSaw).toBe(REG_B);

    resumeA();
    await aPromise;
    expect(aResult.before).toBe(REG_A);
    expect(aResult.after).toBe(REG_A); // B의 것이 아니라 자신의 레지스트리로 재개됨
    expect(getActiveErrorRegistry()).toBe(DEFAULT_ERROR_REGISTRY);
  });

  it("setActiveErrorRegistry is rejected on the server (forces the scoped API, prevents leak)", () => {
    // 클라이언트 싱글톤 설정은 서버 측에서 명시적으로 금지되는데, 이는 정확히
    // 그것이 요청 간 누출을 유발하기 때문이다; 격리는 오직 run()을 통해서만 이루어진다.
    expect(() => setActiveErrorRegistry(REG_A)).toThrow(/client-only/i);
    // throw가 주변 상태를 변형시키지 않았어야 한다.
    expect(getActiveErrorRegistry()).toBe(DEFAULT_ERROR_REGISTRY);
  });
});
```

### 10.3 i18n 폴백 완전성 (CI 가드)

```ts
// error/__tests__/i18n-completeness.test.ts
// §10.3 — i18n 폴백 완전성 CI 가드.
//
// 이 테스트들은 빌드 차단기다: 새 ErrorCode가 코로케이트된 폴백 카피 없이
// 레지스트리에 들어오거나, resolveErrorMessage가 원시 키를 누출하거나 throw하면,
// 이 파일은 실패한다. 런타임 불변식을 단언한다(타입 레벨의
// `satisfies Record<ErrorCode, string>`은 컴파일 타임만 보호한다).
import { describe, it, expect, vi } from "vitest";
import {
  resolveErrorMessage,
  FALLBACK_MESSAGES,
  type Translator,
} from "@/error/translator";
import { DEFAULT_ERROR_REGISTRY, type ErrorCode } from "@/error/registry";

const ALL_CODES = Object.keys(DEFAULT_ERROR_REGISTRY) as ErrorCode[];

// resolveErrorMessage가 최종적으로 폴백하는 궁극의 제네릭 라인. 소스의
// GENERIC_FALLBACK(UNKNOWN_* 엔트리들의 값)과 동기화 상태로 유지된다.
const GENERIC_FALLBACK = FALLBACK_MESSAGES.UNKNOWN_SERVER_ERROR;

describe("§10.3 i18n fallback completeness (CI guard)", () => {
  it("registry is non-empty and has the documented 15 canonical codes", () => {
    // 실수로 비어 있는 순회가 모든 단언을 공허하게 만드는 것을 방지한다.
    expect(ALL_CODES.length).toBe(15);
    expect(ALL_CODES.length).toBeGreaterThan(0);
  });

  it("FALLBACK_MESSAGES has an entry for EVERY ErrorCode in the registry", () => {
    const missing = ALL_CODES.filter(
      (code) =>
        !(code in FALLBACK_MESSAGES) ||
        typeof FALLBACK_MESSAGES[code] !== "string" ||
        FALLBACK_MESSAGES[code].length === 0,
    );
    expect(missing).toEqual([]);
  });

  it("FALLBACK_MESSAGES has no EXTRA keys beyond the registry codes", () => {
    const registryKeys = new Set<string>(ALL_CODES);
    const extra = Object.keys(FALLBACK_MESSAGES).filter((k) => !registryKeys.has(k));
    expect(extra).toEqual([]);
  });

  it.each(ALL_CODES)(
    "resolveErrorMessage(%s) — raw ErrorCode resolves to non-empty copy that is NOT the raw key",
    (code) => {
      const msg = resolveErrorMessage(code);
      expect(typeof msg).toBe("string");
      expect(msg.length).toBeGreaterThan(0);
      expect(msg).not.toBe(code);
    },
  );

  it.each(ALL_CODES)(
    "resolveErrorMessage(userMessageKey of %s) resolves to non-empty copy that is NOT the raw key",
    (code) => {
      const key = DEFAULT_ERROR_REGISTRY[code].userMessageKey;
      const msg = resolveErrorMessage(key);
      expect(typeof msg).toBe("string");
      expect(msg.length).toBeGreaterThan(0);
      expect(msg).not.toBe(key);
      // 레지스트리 userMessageKey는 자신의 코로케이트된 폴백 카피로 매핑되어야 한다.
      expect(msg).toBe(FALLBACK_MESSAGES[code]);
    },
  );

  it("an unknown key returns the safe generic fallback (no throw, never the raw key)", () => {
    const unknown = "some.totally.unregistered.key";
    let msg = "";
    expect(() => {
      msg = resolveErrorMessage(unknown);
    }).not.toThrow();
    expect(msg).toBe(GENERIC_FALLBACK);
    expect(msg).not.toBe(unknown);
    expect(msg.length).toBeGreaterThan(0);
  });

  it("an empty-string key returns the safe generic fallback (no throw)", () => {
    expect(() => resolveErrorMessage("")).not.toThrow();
    expect(resolveErrorMessage("")).toBe(GENERIC_FALLBACK);
  });

  it("a provided Translator is used when it returns a finished (non-key) string", () => {
    const t = vi.fn((key: string) => `translated:${key}`);
    const translator: Translator = { locale: "en", t };
    const out = resolveErrorMessage("error.validation", translator);
    expect(out).toBe("translated:error.validation");
    expect(t).toHaveBeenCalledWith("error.validation", undefined);
  });

  it("Translator vars are forwarded through to t()", () => {
    const t = vi.fn((key: string) => `t:${key}`);
    const translator: Translator = { locale: "en", t };
    resolveErrorMessage("error.validation", translator, { field: "email", n: 3 });
    expect(t).toHaveBeenCalledWith("error.validation", { field: "email", n: 3 });
  });

  it("falls back to co-located copy when the Translator echoes the raw key back (i18next miss convention)", () => {
    // i18next/next-intl에서 누락된 키는 키 자체를 반환한다 — 반드시 거부되어야 한다.
    const translator: Translator = { locale: "en", t: (key) => key };
    const out = resolveErrorMessage("error.validation", translator);
    expect(out).toBe(FALLBACK_MESSAGES.VALIDATION);
    expect(out).not.toBe("error.validation");
  });

  it("falls back to co-located copy when the Translator returns an empty string", () => {
    const translator: Translator = { locale: "en", t: () => "" };
    const out = resolveErrorMessage("error.validation", translator);
    expect(out).toBe(FALLBACK_MESSAGES.VALIDATION);
  });

  it("falls back (and does NOT throw) when the Translator throws", () => {
    const translator: Translator = {
      locale: "en",
      t: () => {
        throw new Error("broken i18n adapter");
      },
    };
    let out = "";
    expect(() => {
      out = resolveErrorMessage("error.validation", translator);
    }).not.toThrow();
    expect(out).toBe(FALLBACK_MESSAGES.VALIDATION);
  });

  it("a throwing Translator on an UNKNOWN key still degrades to the generic fallback", () => {
    const translator: Translator = {
      locale: "en",
      t: () => {
        throw new Error("boom");
      },
    };
    expect(resolveErrorMessage("nope.not.a.key", translator)).toBe(GENERIC_FALLBACK);
  });

  it("a null translator behaves like no translator (provider-free safety-net path)", () => {
    const out = resolveErrorMessage("error.forbidden", null);
    expect(out).toBe(FALLBACK_MESSAGES.FORBIDDEN);
  });

  // ── G2: RATE_LIMITED 폴백은 보간을 통한 {seconds} 카운트다운이다 ──
  it("RATE_LIMITED fallback copy carries the {seconds} interpolation token", () => {
    // 카운트다운을 채워 넣을 수 있도록 템플릿은 반드시 토큰을 포함해야 한다.
    expect(FALLBACK_MESSAGES.RATE_LIMITED).toContain("{seconds}");
    // resolveErrorMessage는 변수를 코로케이트된 폴백에 보간한다.
    const out = resolveErrorMessage("error.rateLimited", null, { seconds: 5 });
    expect(out).toBe("5초 후 다시 시도해주세요.");
    expect(out).not.toContain("{seconds}");
  });

  it("RATE_LIMITED interpolation also works via the raw ErrorCode key", () => {
    const out = resolveErrorMessage("RATE_LIMITED", null, { seconds: 12 });
    expect(out).toBe("12초 후 다시 시도해주세요.");
  });

  it("RATE_LIMITED with NO vars leaves the token verbatim (never throws, never the raw key)", () => {
    // 방어적: 변수를 잊은 호출자도 여전히 (throw하지 않는) 템플릿을 받으며,
    // 원시 키는 아니다 — 따라서 기존의 코드별 .each 가드가 유지된다.
    const out = resolveErrorMessage("error.rateLimited");
    expect(out).toBe(FALLBACK_MESSAGES.RATE_LIMITED);
    expect(out).not.toBe("error.rateLimited");
    expect(out).not.toBe("RATE_LIMITED");
  });

  it("RATE_LIMITED vars are forwarded to a host Translator unchanged", () => {
    const t = vi.fn((key: string, vars?: Record<string, unknown>) =>
      vars && "seconds" in vars ? `wait ${String(vars.seconds)}s` : `t:${key}`,
    );
    const translator: Translator = { locale: "en", t };
    const out = resolveErrorMessage("error.rateLimited", translator, { seconds: 7 });
    expect(out).toBe("wait 7s");
    expect(t).toHaveBeenCalledWith("error.rateLimited", { seconds: 7 });
  });
});
```


---
## 11. 트레이드오프와 과도하게 만들지 말아야 할 것

**솔직한 트레이드오프**

- **연산에 따라 분리된 두 가지 전달 규칙.** 뮤테이션은 `Result`를 반환하고, 쿼리는 던진다(throw). 이 분리는 양 극단을 모두 피하기 위한 비용이다. 전면적 `Result`는 React-Query 사용자를 놀라게 하고 모든 읽기에 세금을 부과하며, 전면적 throw는 폼에서 인라인 필드 에러를 잃는다. 이 규칙은 한 번만 문서화하라(§8.4) — 이것이 가장 흔한 혼란의 원천이며, 시리즈와 팀 아키텍처 문서가 이전에 정확히 의견을 달리했던 지점이다. r3은 *두 개*의 뮤테이션 경계(RPC용 `safeServerAction`, `useActionState`용 `safeFormAction`)를 추가하는데, 이는 두 번째 작은 분기다 — 그러나 둘은 동일한 제어 흐름/리포팅 배관(§7.1a)을 공유하므로 결코 어긋나지 않는다.
- **`severity` + `log`의 중복.** 나는 이 둘을 의도적으로 분리했으며, r3에서 마침내 `severity`를 `Notifier` 알림 게이트(§5.1)에 연결함으로써 `severity`를 load-bearing하게 만든다. 더 작은 앱은 여전히 `severity`를 버리고 Sentry 레벨을 `log`에서 곧바로 도출할 수 있다 — 그러나 이제 severity가 페이저를 구동하므로, "필요해질 때까지 severity 기반 알림을 연결하지 말라"는 이미 *완료되어*, 사용하지 않을 때는 비용이 들지 않도록 `noopNotifier` 기본값 뒤에 자리잡았다.
- ***활성 레지스트리*는 런타임 상태의 작은 조각이다.** 이는 레지스트리를 주입(DI) 가능하게 *그리고* 인자 없는(zero-arg) getter에서 읽을 수 있게 만드는 데 드는 비용이다(§3). 서버에서는 `AsyncLocalStorage`를 통해 요청 범위(request-scoped)로, 클라이언트에서는 싱글턴으로 존재한다. 어떤 `runWithErrorRegistry` 범위 *밖*에서 서버의 getter를 읽으면 조용히 `DEFAULT_ERROR_REGISTRY`로 폴백한다 — 이는 의도된 안전 기본값이지만, *대체된* 레지스트리에 의존하는 서버 코드는 반드시 해당 범위 안에서 실행되어야 한다(요청별 핸들러는 그렇게 한다, §7.1a).
- **요청별 서버 핸들러 인스턴스**는 매 요청마다 작은 할당 비용이 들며, 이제 React `cache()`(§7.1a)로 메모이즈된다. 정확성을 위해 옳은 선택이다(요청 간 user/correlation 누출 없음). 이를 모듈 싱글턴으로 "최적화"하지 말라 — 그것은 누출을 재도입하며, §10.2 안티패턴 테스트가 이를 입증한다.
- **`unstable_retry`는 불안정하다.** Next 버전을 고정하고 이를 `ErrorFallback` 뒤로 추상화하라(완료됨). 그러면 이름 변경이 단일 파일 변경으로 끝난다. 마찬가지로 `proxy.ts`와 `unstable_rethrow`는 각각 하나의 모듈로 격리되어 있다.

**만들지 말아야 할 것**

- **제품 분석(analytics)을 에러 파이프라인으로 라우팅하지 말라.** 분석(GA/Amplitude)은 형태와 수명주기가 다른 별개의 관심사다. 에러 시스템의 싱크는 `Reporter`(모니터링) + `Presenter`(UX) + `Notifier`(알림)이며 — 결코 분석이 아니다. "에러가 발생했다"가 제품 지표이기도 해야 한다면, `handleError` 호출과 나란히 기능/UI 레이어에서 그것을 방출하라.
- **맨몸의 `ERROR_REGISTRY` const를 재도입하지 말라.** 그것이 r2 버그(TS2304)였다. 유일한 카탈로그 심볼은 `DEFAULT_ERROR_REGISTRY`와 `getActiveErrorRegistry()` 뒤의 *활성* 레지스트리뿐이다.
- **`DomainError.fromSerialized`가 와이어를 맹목적으로 신뢰하게 만들지 말라** — 그것은 `details`를 재검증한다. 그리고 클라이언트 바운드 직렬화기가 누출하게 만들지 말라. 모든 클라이언트 경로는 `toClientSerialized`(§5.2)를 거치며, 결코 `toSerialized()`를 거치지 않는다.
- **`makeError` 검증 누락에 대해 `SCHEMA_INVALID` 에러 코드를 발명하지 말라.** 그것들은 dev/CI에서 드러나야 할 프로그래머 실수다. 프로덕션에서는 `UNKNOWN_*` 폴백이 옳으며, 거기에 도달하는 것 자체가 하나의 신호다.
- **`forbidden()`/`unauthorized()`가 실험적인 동안에는** 프로덕션에서 load-bearing하게 만들지 말라. 그것들을 게이트하고, 기본값으로 `redirect`/`Result`를 사용하라. (`rethrowControlFlow`는 그것들이 발생하면 여전히 손대지 않고 다시 던진다.)
- **코드를 과도하게 세분화하지 말라.** 시리즈의 테스트가 옳다. *"동료가 Sentry에서 이 코드를 보고 즉시 어디를 봐야 할지 알 수 있을까?"* 두 코드가 항상 동일한 `{present, log, httpStatus}`와 동일한 대시보드 처리를 받는다면, 그것들을 병합하라. `RATE_LIMITED`가 자신만의 코드를 얻는 이유는 *오직* `HTTP_CLIENT_ERROR`와 중요한 단 하나의 축에서 다르기 때문이다: `retryable`.
- **DI 컨테이너/프레임워크를 추가하지 말라.** 평범한 팩토리 함수와 몇 개의 React 컨텍스트로 충분하다.
- **`error.tsx`로 이벤트 핸들러/비동기 에러를 잡으려 하지 말라.** 그것은 렌더링만 잡는다. `safeHandler` + 윈도우 경계가 올바른 도구다. `startTransition` 에러는 경계로 *실제로* 버블링되는 단 하나의 예외다. 이벤트 핸들러의 `page` 코드에 대해서는, 평범한 이벤트 핸들러에서 던져진 에러가 `error.tsx`에 도달하지 않으므로 다시 던지기보다 전용 라우트 내비게이션(`PAGE_ROUTE_BY_CODE`)을 선호하라.
- **프로덕션에서 RSC 에러에 대해 사용자에게 원시 `error.message`를 표시하지 말라** — 그것은 일반적 플레이스홀더다. i18n 레이어(§6.3)를 통해 해석된 `userMessageKey`를 사용하라. `digest`는 불투명한 지원용 참조로만 드러내라.

---

### 재조정 요약 (시리즈 ↔ 팀 아키텍처 문서 ↔ Next.js v16.2.x)

| 시리즈 개념 | 그대로 유지 | 재조정 / 확장 |
|---|---|---|
| `ERROR_REGISTRY` SSOT(단일 진실 공급원) | ✅ 키 → `ErrorCode` | `HandleErrorDeps.registry`를 통해 **주입됨**. 런타임 권위는 *활성* 레지스트리(§3.2, 클라이언트 싱글턴 / 서버 `AsyncLocalStorage`). `severity`, `httpStatus`, `retryable`, `userMessageKey` 추가. `expected:boolean`을 3방향 `kind: ErrorKind`(`"business" \| "operational" \| "fault"`)로 대체 — **출시됨**, `isExpectedCode(code) = registry[code].kind === "business"`와 함께. `FORBIDDEN` + `RATE_LIMITED` 추가. `ErrorRegistry = Record<ErrorCode, ErrorMeta>` |
| `DomainError`/`makeError` | ✅ 생성 경로, Zod `details`, `UNKNOWN_*` 폴백 | `AppError`로 별칭 부여. getter는 활성 레지스트리를 읽는다 — `kind`, `expected`(= `kind === "business"`), `isOperational`(= `kind !== "fault"`), `present`(`ux`에서 이름 변경). 하나의 `construct()` 캐스트. `fromSerialized` 재수화(rehydration). `digest` 왕복(round-trip). `resolvePolicy`/`ResolvedAppError` |
| `normalize`(명명되었으나 r2에서 정의되지 않음) | — | `normalizeToDomainError`(1단계)로 **정의됨**: 와이어 페이로드를 재수화하고 프레임워크 Error 형태를 매핑한다. `normalize`는 `@deprecated` 별칭으로 유지 |
| 투 트랙 + 단일 `handleError` | ✅ 글자 그대로의 약속 | **연산에 따라 분리된 전달: 뮤테이션 = `Result`(`safeServerAction` RPC + `safeFormAction` 폼), 쿼리 = throw**. `handleError`는 `ResolvedAppError`를 반환한다. r5 시퀀스는 명시적이다: (1) `log !== "none"`이면 리포트, (2) 통지(notify), (3) `present`가 `"toast"`/`"alert"`일 *때만* `Presenter` 호출, (4) `present !== "silent"`일 때마다 **영향(impact) breadcrumb(브레드크럼)**(`reporter.breadcrumb`) 방출 — fault는 한 번 포착되고 사용자 영향은 별도로 기록되어, 기존의 중복 로깅 금지 혼동을 해소한다 — **출시됨** |
| `Reporter` / `Presenter` 주입(DI) | ✅ 두 싱크 모두 유지. DI, 요청별 서버 / 싱글턴 클라이언트 | **+ `Notifier`**(알림, `AlertPolicy`로 게이트됨, 페이저 어댑터). `Reporter`는 영향(impact) 추적을 위한 `breadcrumb()`를 얻음. `guardedCompositeReporter` dead-man-switch(데드맨 스위치). 강화된 Sentry(`beforeSend` PII 스크럽, `fingerprint`, 스톰 스로틀). `serverDeps`/`buildClientDeps` 정의됨. React `cache()`를 통한 서버 핸들러(요청 간 누출 없음) |
| 직렬화 | ✅ 클래스 인스턴스가 경계를 넘지 않음 | **`toClientSerialized`**가 누출 방지 강제 지점이다(`message` 제거, 코드별 allowlist로 `details` 게이트). 서버 로그용 `toInternalSerialized` |
| i18n `userMessageKey` | ✅ 모든 행에 키 | **연결됨**: 라이브러리 비종속 `Translator`, 레지스트리에 함께 위치한 `FALLBACK_MESSAGES`(컴파일 검사됨), 결코 던지지 않는 `resolveErrorMessage`, `global-error.tsx`용 provider 없는 폴백, CI 완전성 테스트 |
| `retryable` | ✅ 모든 행의 필드 | **load-bearing**: 공유 `QueryClient` 술어(`NOT_FOUND`는 0회 재시도), 서버 `Retry-After`를 선호하는 하나의 `computeRetryDelay` 오라클, 서버 `withRetry` |
| `{error, reset}` 경계 | ✅ `error.tsx`/`global-error.tsx`, `log:"none"` | `reset` 폴백과 함께 `unstable_retry` 추가. `digest` 드러냄. `ErrorFallback` `minimal` provider 없는 경로 |
| safeServerAction / networkBoundary / safeHandler / 브라우저 경계 | ✅ 여섯 경계 모두 | `networkBoundary<T>` 완전히 정의됨. 인터럽트용 `raise()`. Route Handler `httpStatus` + `toClientSerialized`. 브라우저 경계는 스톰 스로틀을 위해 `ctx.route`를 태깅. `page` `PresentAction` 에스컬레이션 메커니즘 |
| Correlation ID / proxy | — (시리즈에는 correlation 없음) | **종단 간(end-to-end)** correlation ID + 사용자 컨텍스트. `TelemetryContext`는 미사용 `traceId?`(OTel 솔기)를 얻음. **`proxy.ts`(Node 런타임)** 프레이밍(이전에는 `middleware.ts`/edge). `runtime`은 `"server" \| "client"`로 좁혀짐. 인터럽트 + `httpStatus`를 통한 401/403/404/500 구분 |

모든 블로그 출처는 접근 가능했으며 존중되었다. **r3은 r2의 모든 컴파일 에러와 미정의 심볼 격차를 닫고, r2가 선언만 했던 기능들을 완전히 연결한다 — 잘려나간 기능은 없으며, 격차가 연결되었다.** 열한 가지 r3 변경(활성 레지스트리 컴파일 수정, 재수화, `networkBoundary`, `cache()` 핸들러, `safeFormAction`, `retryable`/429, severity→`Notifier` 알림, `page` 메커니즘, i18n, 직렬화기 강제 + Sentry 강화, `proxy.ts` 프레이밍)은 각각 사용자의 엄격한 요구사항, Next.js v16.2.x 문서, 또는 구체적인 r2 결함에 비추어 정당화되며, 각각은 §10 테스트 매트릭스의 한 행으로 뒷받침된다. **r5는 3방향 `kind` enum(기존 `expected:boolean` 제안을 대체), 새로운 `"inline"`/`"silent"` 분리를 갖춘 `present` 액션, 그리고 영향(impact) breadcrumb(브레드크럼) 추적을 출시한다 — 이전 개정들이 스케치만 했던 나머지 의미론적 격차를 닫는다.**

---
## 12. 검증된 구현과 재조정

이 설계는 단지 예시에 그치지 않는다 — 컴파일되고 테스트된 레퍼런스 프로젝트로 구체화되었으며, 이 절은 그 증거와 함께 구현이 예시 스니펫을 실제 라이브러리/모듈 맵 현실에 재조정한 모든 지점을 기록한다.

### 12.1 검증

- `turbo run typecheck` → 3개 패키지 `tsc --noEmit` 모두 exit 0 (플래그: `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `moduleResolution: bundler`, `jsx: react-jsx`).
- `turbo run test` → 17개 테스트 파일, **324개 테스트, 0개 실패** — 패키지별 분포: `error-core` 277 / `error-adapters` 11 / `error-next` 36 (§10 스위트에서 Playwright E2E 계층 제외).
- `apps/error-architecture` → `next build`(Next 16.2, Turbopack) 성공: 10개 라우트, TypeScript 통과, `proxy.ts` 인식, `authInterrupts` 활성. 런타임 스모크: `x-request-id` 종단 간 전파, `/api/health` 200, `networkBoundary` 프로토콜 응답, `raise()` 인터럽트(not-found→404 / forbidden→403).
- 재현(모노레포 루트): `pnpm install && pnpm turbo run typecheck test && pnpm build`.
- 정본 소스 트리: `packages/error-core/src`(+ `adapters/`), `packages/error-adapters/src`, `packages/error-next/src`(+ `components/`), `apps/error-architecture`(`app/`, `lib/`, `proxy.ts`). 테스트는 각 패키지 `src/**/__tests__/` 아래에 위치한다.

### 12.2 실제 라이브러리 적응 (예시 → 컴파일)

| 위치 | 설계가 보여준 것 | 검증된 코드 | 이유 |
|---|---|---|---|
| Sentry `beforeSend` (§5.3) | `event.user = … : null` | `event.user = … : undefined` | `@sentry/nextjs` v8 타입은 `event.user`를 `\| null`이 아닌 `User \| undefined`로 정의하므로, `null`을 할당하면 TS2322이다. |
| `safeServerAction` 검증 (§7.1) | `parsed.error.flatten().fieldErrors` | `… .fieldErrors as Record<string, string[]>` | zod의 `flatten()`은 값 타입을 넓힌다; 레지스트리 `details` 스키마는 `Record<string, string[]>`를 기대하므로, `makeError`를 만족시키려면 캐스트가 필요하다. 재사용 가능한 소비자 측 리더는 새로운 `fieldErrorsFromError` 헬퍼이다 (§12.5). |
| `networkBoundary` 상태 클래스 (§8.5) | `const code: ErrorCode = status >= 500 ? …` | `const code: "HTTP_SERVER_ERROR" \| "HTTP_CLIENT_ERROR" = …` | `ErrorCode`로 넓히면 `details`가 전체 유니온을 만족하도록 강제되어 `makeError`의 추론이 깨진다; 좁혀진 리터럴은 `{ status }`가 타입 체크를 통과하게 한다. 이 경계는 또한 아웃바운드 페이지 `correlationId`를 찍어 넣는다 (§12.5). |
| Sentry reporter (§5.3) | `captureException(error, { … })` 평범한 컨텍스트 | `captureException(error, (scope) => { … })` | v8 `captureException`은 `setFingerprint`/`setContext`/`setLevel`을 위해 `CaptureContext` 콜백 형태 `(scope) => {…}`를 받는다. |
| `browser-boundary` 핸들러 (§8.3) | DOM 핸들러 본문으로서 `=> handleError(…)` | `=> void handleError(…)` | `handleError`는 `ResolvedAppError`를 반환한다 (r3); `window.onerror`/`onunhandledrejection`은 `void`/boolean 반환을 기대하므로, 결과는 `void`로 폐기된다. |

### 12.3 모듈 구성 재조정 (설계가 출하된 트리보다 더 잘게 분할됨)

| 설계 모듈 | 출하 형태 | 비고 |
|---|---|---|
| `serialize.ts` (`CLIENT_DETAILS_ALLOWLIST`, `toInternalSerialized`) | `serialize-client.ts` (타입화된 `DETAILS_ALLOWLIST`); `toInternalSerialized`는 `adapters/console-reporter.ts`에 인라인화됨 | 클라이언트 직렬화기가 유일하게 출하된 serialize 모듈이다; `DETAILS_ALLOWLIST`는 이제 코드별 타입화된 allowlist 객체이다 (§12.5). 서버 로그 형태는 그 단일 소비자(console reporter)에 국소적이다. |
| `alert-policy.ts` + `notifier.ts` | 단일 `notifier.ts` | `AlertPolicy`, `thresholdAlertPolicy`, `policyGatedNotifier`는 자신들이 게이트하는 `Notifier`와 함께 위치한다 (모듈 맵). |
| `server/server-deps.ts` + `server/session.ts` + `server/*` 핸들러 분할 | 단일 `request-handler.server.ts` | `serverDeps`, `getSessionUser`, `getRequestCorrelationId`, `getRequestHandler`가 하나의 `'server-only'` 모듈로 합쳐진다. |
| `error/i18n/` (`locale.ts`, `translator.ts`, `ko`+`en`을 가진 `fallback-messages.ts`, `fallback-translator.ts`, `resolve.ts`, adapters, context, server) | 단일 `translator.ts` | 단일 로케일(한국어) `FALLBACK_MESSAGES: Record<ErrorCode, string>` + `KEY_TO_CODE` 역인덱스; `en` 컬럼과 로케일별 `i18n/` 분할은 문서화된 향후 확장이다 (§6.3). |
| `build-deps.ts` | `components/ErrorHandlerInit.tsx`에 인라인화된 `buildClientDeps()` | 클라이언트 컴포지션 루트가 유일한 소비자이다; 별도 모듈 없음. |
| `page-routes.ts` (`PAGE_ROUTE_BY_CODE`) | `use-error-handler.ts`에 인라인화됨 | 훅을 자기 완결적으로 유지한다 (자신이 소유하지 않은 것을 참조하지 않음). |
| `backoff.ts` + `retry-after.ts` | 실제 공유 헬퍼 모듈 `backoff.ts` + `retry-after.ts` | 독립 모듈로 유지됨 — `query-client.ts`와 서버 `withRetry` 양쪽 모두 이들을 소비한다. |
| `makeQueryClient` | `export const makeQueryClient = createAppQueryClient` 별칭을 가진 `createAppQueryClient` | 정본 팩토리 이름이 별칭으로 익스포트되어 모듈 맵 이름이 해석된다; 이는 `core/error` 배럴에서 재익스포트된다 (§12.5). |
| `getSessionUser` 서버 이음새 | 익명(`null`)을 반환하는 `getSessionUser` | 독립 빌드에는 인증 공급자가 없으므로 익명으로 해석된다; 호스트가 자신의 실제 세션 조회로 교체한다. |

### 12.4 상태

§1–§11의 모든 코드 블록은 이제 컴파일되는 구현과 일치하거나, 출하된 트리가 통합한 지점이 주석으로 표시되어 있다. 아키텍처는 완전하며(잘려나간 기능 없음) 타입 수준 + 단위/통합 수준에서 종단 간으로 검증되었다. 이 문서는 r5 검증된 트리와 일치하며(47개 소스 + 17개 테스트 파일, `tsc` exit 0, `vitest` 324/0), **r6에서 동일한 트리가 Turborepo + pnpm 모노레포의 세 패키지 + Next 16 앱으로 재구성되었다(설계 불변, §12.6)** — 324개 테스트가 패키지별(277/11/36)로 그대로 통과하고 앱이 Next 16.2로 빌드된다.

### 12.5 r5 변경

r5는 검증된 재조정 패스이다. 전역 리네임을 넘어, 정책 어휘를 조이고, 이전 개정들이 보류한 갭 수정을 마무리하며, 마지막 플레이스홀더 어댑터를 실제 라이브러리 코드로 교체한다. 아래의 모든 것은 검증된 트리에 반영되어 있다.

**리네임 (§1–§11 전반에 적용).**

- `type UxAction` → `type PresentAction`. 기존의 단일 `none`은 두 개의 구별되는 결과로 **분할**된다: `inline` (필드나 폼 옆에 렌더링되는 business/validation 오류 — presenter 호출 없음)과 `silent` (`REQUEST_ABORTED`처럼 진정으로 조용한 것 — presenter 호출 없음 *그리고* 영향(impact) breadcrumb도 없음). 전체 유니온은 이제 `"inline" | "toast" | "alert" | "redirect" | "page" | "silent"`이다.
- `ErrorMeta.ux` → `ErrorMeta.present`; `HandleErrorOptions.ux?` → `HandleErrorOptions.present?`.
- `ErrorMeta.expected: boolean` → `ErrorMeta.kind: ErrorKind`, 여기서 `ErrorKind = "business" | "operational" | "fault"`이다. `isExpectedCode(code)`는 이제 `registry[code].kind === "business"`이다. `DomainError` 게터들은 `kind`에서 파생된다: `kind`, `expected` (`= kind === "business"`), `isOperational` (`= kind !== "fault"`), 그리고 `present` (이전의 `ux`).

**영향(impact) breadcrumb (T1).** `handleError`는 더 이상 "fault를 로깅하는 것"과 "사용자 영향(impact)을 기록하는 것"을 뒤섞지 않는다. 그 순서는 이제 다음과 같다:

1. **report** — `log !== "none"`일 때만 `reporter.report(error, log, ctx)`를 호출한다 (fault는 여기서 *한 번* 캡처된다).
2. **notify** — `notifier.notify(error, severity, ctx)`를 호출한다 (알림 게이트; 임계값 미만에서는 no-op).
3. **present** — Presenter가 처리 가능한 두 표면 `"toast"`/`"alert"`에 대해 **오직** `presenter.present(error, present, ctx)`를 호출한다. `"redirect"`/`"page"`는 (Presenter가 아니라) 클라이언트 `useErrorHandler`가 에스컬레이션한다; `"inline"`/`"silent"`는 여기서 아무것도 하지 않는다.
4. **breadcrumb** — `present !== "silent"`일 때마다 `reporter.breadcrumb(error, present, ctx)`를 통해 *영향(impact) breadcrumb*를 방출하며, `ctx.correlationId`로 키잉되고 **`log`와 독립적이다**. 이는 두 번째 캡처 *없이* 사용자에게 보이는 영향(impact)을 기록한다.

이것은 기존의 중복-로깅-금지 혼동에 대한 수정이다: fault는 한 번 캡처되고(1단계) 사용자 영향(impact)은 breadcrumb로 별도로 기록되므로(4단계), 시끄러운 코드를 재캡처 없이 영향(impact)-추적할 수 있고, `none`이 아닌 log가 더 이상 영향(impact) 신호를 겸하지 않는다. `Reporter` 인터페이스는 `breadcrumb(error, surface, ctx)` 메서드를 얻었다; `TelemetryContext`는 선택적 `traceId?`를 얻었다 — 향후 OTel 트레이스 상관관계를 위해 관통하여 전달되는 이음새로, r5에서는 미사용이다.

**r5에서 출하된 갭 수정.**

- **실제 Sonner presenter.** `adapters/sonner-presenter.ts`는 이제 `sonner` SDK를 임포트하는 유일무이한 파일이다. i18n 키를 메시지로 해석하며(원시 키를 절대 렌더링하지 않음), `error.code`를 토스트 `id`로 사용하여 동일 코드의 폭주를 단일한 제자리 갱신 토스트로 중복 제거한다. 오직 `"toast"`/`"alert"`만이 사용자 대면 토스트 표면에 도달한다.
- **`RATE_LIMITED` 카운트다운.** presenter는 `RATE_LIMITED` 오류의 공개 `retryAfterMs` 디테일로부터 `{seconds}` 카운트다운을 보간하며(G2/G6), `any` 캐스트 없이 인스턴스에서 그것을 읽어낸다.
- **타입화된 `DETAILS_ALLOWLIST`.** `serialize-client.ts`는 코드별 타입화된 allowlist 객체를 출하한다(더 느슨한 `CLIENT_DETAILS_ALLOWLIST`를 대체); 직렬화기는 각 코드를 그 안에서 조회한다.
- **재사용 가능한 배럴.** `core/error/index.ts`는 공개 표면(`makeError`, `isDomainError`/`isExpectedCode`/`DomainError`, `actionSuccess`/`actionFailure`/`Result`, `useErrorHandler`, `resolveErrorMessage`, `fieldErrorsFromError`, `makeQueryClient`)을 재익스포트하므로, 소비자는 깊은 경로가 아니라 패키지 루트에서 임포트한다.
- **`/api/health`.** `force-dynamic`, `nodejs` 런타임 `GET` 라우트(`src/app/api/health/route.ts`)는 서버 reporter의 판정에 따라 200에서 `{ status: "ok" }`를, 503에서 `{ status: "degraded" }`를 반환한다 (절대 캐싱되지 않음).
- **`networkBoundary` 아웃바운드 correlationId (G8).** 이 경계는 프록시가 심어둔 `httpOnly`가 아닌 `x-correlation-id` 쿠키를 읽어, 갓 생성된 `DomainError`에 찍어 넣어 라우트 핸들러가 인바운드를 존중하도록 한다; 좁혀진 `HTTP_SERVER_ERROR | HTTP_CLIENT_ERROR` 리터럴(§12.2)이 `{ status }`를 운반한다.
- **`ErrorFallback` 재시도 + a11y (G11).** v16.1 `{ error, reset }` 계약과 승격된 `unstable_retry`(선호됨 — refetch + rerender)를 모두 지원한다; `reset`만 존재할 때는 *또한* `router.refresh()`를 호출하여 Next 15에서 RSC 페이로드가 다시 페치되도록 한다. 접근성: `role="alert"` 컨테이너는 마운트 시 포커스된다; 재시도는 pending/disabled 버튼 상태와 함께 `useTransition` 안에서 실행된다; 재시도 어포던스는 재시도 불가능한 코드에 대해 숨겨진다; report 이펙트는 `try/catch`로 감싸진다.
- **Pager 타임아웃 + 중복 제거 (G7).** `adapters/pager-notifier.ts`는 아웃바운드 `fetch`를 `AbortSignal.timeout(5000)`으로 제한하고, `dedupKey`별(`${code}:${route}`) 억제기로 동일 인시던트의 폭주를 통합한다 — 윈도우당 `dedupKey`당 한 번의 페이지 (기본 60초).
- **활성 레지스트리 1회 경고.** `active-registry.ts`는 클라이언트 레지스트리가 호스트-바운드가 아닌 기본 스코프로 해석될 때, 매 해석마다 경고하는 대신 (`warnMissingScopeOnce()`를 통해) 정확히 한 번 경고한다.
- **`fieldErrorsFromError` 헬퍼.** 소비자 측 헬퍼(`field-errors.ts`, 배럴에서 재익스포트됨)가 캐스트 없이 `DomainError`로부터 검증 `fieldErrors`를 되읽어, `safeServerAction` 쓰기 경로(§12.2)를 보완한다.
- **`traceId` 이음새.** `TelemetryContext.traceId?`는 OTel 상관관계 이음새로서 변경 없이 관통하여 전달된다 (r5에서는 미사용).

**보류됨 (의도적으로 r5 범위 밖).**

- 도메인별 레지스트리 분할 (단일 `ERROR_REGISTRY`는 아직 도메인별로 분할되지 않았다).
- 완전한 OTel `traceparent` 전파 (오직 `traceId?` 이음새만 존재한다).
- zod 번들 분할 (검증 스키마는 아직 클라이언트 번들에서 코드 분할되지 않았다).
- `<Suspense>`별 스트리밍 문서화 패턴 (스트리밍 오류 이야기는 아직 경계별로 작성되지 않았다).

### 12.6 모노레포 분리 (r6 — Turborepo + pnpm)

r6은 r5의 검증된 단일 트리(`src/core/error/` 외)를 **재작성 없이** 세 워크스페이스 패키지 + Next.js 16 레퍼런스 앱으로 재구성한다. 동기는 §1 원칙 3(모든 것은 주입되며 기능 코드에 하드와이어 없음)과 "벤더를 아는 파일은 하나"라는 DI 격리를 *물리적 패키지 경계*로 끌어올려, 소비자가 필요한 만큼만 설치하게 하는 것이다 — `error-core`는 `zod` 하나만 의존한다.

**구조 + 의존 방향(단방향).**

```
packages/
  error-core/     # zod만 의존 · isomorphic 커널            ◄┐
  error-adapters/ # Sentry·sonner·pager (optional peerDeps) ◄┤── error-next ◄── apps/error-architecture
  error-next/     # Next/React 통합 (peer: next·react·@tanstack)
apps/
  error-architecture/  # 위 패키지를 소비하는 Next 16(App Router, Turbopack) 앱
```

**모듈 → 패키지 매핑.** 원본 `src/core/error/`의 각 모듈은 외부 의존(`next`/`react`/`"server-only"`/벤더 SDK)의 유무에 따라 배치된다.

| 패키지 | 들어간 모듈 | 외부 의존 |
|---|---|---|
| `error-core` | severity · policy · runtime · registry · schema · active-registry · app-error · make-error · normalize · serialize-client · result · telemetry · notifier · translator · types · handle-error · retry-after · backoff · network-boundary · route-handler · field-errors · handler · safe-handler · browser-boundary · `adapters/`console-reporter·composite | `zod`만 |
| `error-adapters` | sentry-reporter · sonner-presenter · pager-notifier | `@sentry/nextjs`·`sonner` (optional peer), `server-only`(pager) |
| `error-next` | next-control-flow · raise · request-handler.server · safe-server-action · safe-form-action · with-retry · use-error-handler · registry-context · query-client · `components/`ErrorFallback·ErrorHandlerInit · 배럴 index/server | `next`·`react`·`@tanstack/react-query` (peer), `@sentry/nextjs`(서버 기본 deps용 optional peer) |
| `apps/error-architecture` | layout·providers·composition-root·error-init · error.tsx·global-error.tsx·not-found·forbidden·unauthorized · `/api/health`·`/api/flaky` · 데모(form-action·query-retry·boundaries·server-retry) · `proxy.ts` | next 16·react 19.2 + 위 세 패키지 |

> `proxy.ts`는 앱 루트로 이동했다(Next 16 컨벤션, §9). `route-handler.ts`(`toErrorResponse`, Web `Response`만 사용 — 프레임워크 무관)는 `error-core`에 두고 `error-next/server`에서 재노출한다. §10.2 `per-request-isolation` 테스트는 순수 `active-registry`(ALS) 테스트라 `error-core`에 둔다.

**분리에서 생긴 재조정(설계 불변, 배선만 변경).**

- **배럴 3개.** 클라이언트 배럴 = `error-next`(= `export * from "error-core"` + React/Next 진입점), 서버 배럴 = `error-next/server`, 커널 배럴 = `error-core`(§7.1b). 원본 `core/error/index.ts`가 들고 있던 `useErrorHandler`·`makeQueryClient`는 React/Next 의존이라 `error-next`로 옮겨졌고, 나머지 클라 안전 표면은 `error-core` 배럴에 남아 `export *`로 합쳐진다.
- **컴파일·해소 모델.** 패키지는 **raw-TS(빌드 단계 없음)** — `package.json`의 `exports`가 `.ts` 소스를 직접 가리킨다(`"."`→`index.ts`, `"./*"`→`./src/*.ts`, error-next는 `"./server"` 추가). 앱은 `next.config.ts`의 `transpilePackages: ["error-core","error-adapters","error-next"]`로 트랜스파일한다. cross-package import는 패키지명(`error-core/app-error` 등)으로, 패키지 *내부* import는 상대 경로로 유지된다.
- **컴포지션 루트는 앱이 소유.** 라이브러리의 `ErrorHandlerInit`은 no-op deps 기본을 싣지만, 데모 앱은 `lib/composition-root.ts`의 `buildClientDeps()`로 sonner presenter + guarded console reporter를 조립하고(클라), 서버는 `error-next/server`의 기본 `serverDeps`를 쓴다(Sentry는 `Sentry.init()` 없으면 no-op — 교체 패턴은 해당 파일 주석 참조). 이는 원본 §12.3의 "buildClientDeps를 ErrorHandlerInit에 인라인"을 앱 레이어의 명시적 DI 루트로 되돌린 것이다.
- **단일 출처화.** `error-next/server`는 `withRetry`/`WithRetryOptions`만 재노출하고, `BackoffConfig`/`DEFAULT_BACKOFF`는 `error-core`(backoff.ts)를 단일 출처로 둔다(중복 공개 표면 제거).
- **테스트 보존.** 17개 테스트 파일은 각 패키지로 분산되되 원본 `@/error/*`·`@/components/*` 별칭을 그대로 쓰고, 패키지별 `vitest.config.ts`가 이를 라우팅한다(next-internal→`./src`, core→`error-core/*`, 벤더→`error-adapters/*`). cross-package `vi.mock`은 alias 타깃과 소스 import가 동일 realpath로 해소되어 매칭된다.
- **벤더 버전 핀(의도적).** 커널/어댑터/통합의 dev·peer는 검증 baseline(zod3·@sentry8·sonner1·TanStack5·vitest2·next15.1.4 dev)을 유지해 324개 테스트를 보존한다. **앱만** Next 16.2 + React 19.2. peer 범위 `next >=15.1.0`이 둘 다 커버하며, @sentry8은 next16 peer를 공식 지원하지 않지만 빌드 플러그인 미사용·런타임 SDK만 쓰므로 무해하다.

**레퍼런스 앱이 시연하는 것.** `/demo/form-action`(safeFormAction + useActionState; VALIDATION 인라인 / INVALID_CREDENTIALS Result.Failure), `/demo/query-retry`(networkBoundary + TanStack; retryable 배선·Retry-After·토스트), `/demo/boundaries`(raise() → notFound/forbidden, fault → error.tsx), `/demo/server-retry`(withRetry 서버 재시도), `/api/health`(dead-man's-switch), `proxy.ts`(종단 간 correlationId).

**명령어.** `pnpm install` → `pnpm turbo run typecheck test`(324/0) → `pnpm build`(앱 Next 16 빌드) → `pnpm dev`.

> **보류됨(r6 범위 밖).** npm 스코프 부여(현재 비스코프 `error-core`/`error-adapters`/`error-next`), 패키지의 빌드 산출물(`dist`) 발행(현재 raw-TS 소비 전용), Changesets 기반 버전 관리, 벤더 SDK 업그레이드(@sentry 8→10 등 — 어댑터가 v8 API에 맞춰져 있어 테스트 보존을 위해 보류).
