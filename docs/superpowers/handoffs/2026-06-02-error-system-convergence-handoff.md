# Handoff — error-system 수렴(convergence) 작업

> **[수렴 종결 — 2026-06-05]** 아래 본문은 P3c 완료 시점(2026-06-02)의 사료다. 이후 **P3e·P5·P6·P7·P8이 전부 완료되어 수렴이 종결**됐다 — 워크스페이스 전체 `pnpm turbo run typecheck test lint` 11/11 green(core 296 · adapters 21 · next 37 · 앱 typecheck+lint). 단일 시스템: `error-core ← error-adapters ← error-next ← apps/error-architecture`. `error-decision-system`+데모 앱은 은퇴(삭제). phase별 계획·리뷰 기록은 `docs/superpowers/plans/`.

## 한 줄 요약
구 에러 스택(`error-core`/`error-adapters`/`error-next` — 메커니즘 강·정책 약)과 신 `error-decision-system`(정책 강·메커니즘 없음, demo)을 **수렴**(deprecate 아님): 신 시스템의 결정 엔진을 구 `error-core`에 이식해 단일 통합 시스템으로 만드는 중. 8-Phase 중 P0–P3c 완료, P3e부터 재개 대기.

## 브랜치 / 위치
- 작업 브랜치: **`docs/error-system-convergence-p3a`** (HEAD `3c306f3`). 이게 모든 작업을 담은 최신 브랜치 — `docs/error-system-convergence-rfc`의 선형 상위집합, `main`(`89f37bd`)에서 분기.
- 모든 산출물 커밋됨. 작업 트리 clean.

## 참조 산출물 (중복 금지 — 경로로 참조)
- RFC(설계): `docs/superpowers/specs/2026-06-02-error-system-convergence-design.md` — 12장 + 잠긴 결정. **먼저 읽을 것.**
- 구현 계획: `docs/superpowers/plans/2026-06-02-error-system-convergence-{p0-p2,p3a,p3b,p3b-ii,p3c}.md`. **잠긴 결정 D1–D7은 p3a 계획 문서**에 정의.
- 작업 메모리: `~/.claude/projects/-Users-hm2-Private-error-system/memory/error-system-convergence.md` (진행도 상태 — 매 phase 갱신해 옴).
- 신 시스템 설계 원본: `docs/history/ERROR_DECISION_SYSTEM.md`, `docs/history/NEW.md`, `docs/history/NEW_DX.md`.

## 완료 (전부 opus/sonnet 2단계 리뷰 통과, sound)
P0–P2(엔진/카탈로그/validateCatalog를 `error-core/src/decision/`에 비파괴 이식) · P3a(순수데이터 `AppError`+`createDecisionSystem` 팩토리 비파괴 착륙) · P3b-i(field-errors/retry-after를 `isAppError`로) · **P3b-ii**(인바운드 원자 컷: make-error/normalize→AppError, handle-error를 `createDecisionSystem` 위임자로 재작성, D1 카탈로그 validateDetails, D2 frozen code-set guards) · **P3c**(아웃바운드 컷: `serialize-client.ts` 삭제→`decision/system.toClientErrorPayload` 단일 누출게이트, result `degrade`(D3), route-handler `createErrorResponder`, network-boundary AppError+D2).

**신 모델이 `error-core`에 완전히 live.** error-core green = **319 tests**.

## ⚠️ 현재 RED 터널 (kernel-only 스코프 — 의도됨)
- **게이트 = `pnpm --filter error-core typecheck && pnpm --filter error-core test` (319 green) 만.**
- 워크스페이스 전체(`pnpm test`)는 **error-next·error-adapters·apps가 컴파일 깨짐 — 예상·정상.** 각각 **P5·P6·P8**에서 un-red.
- error-adapters는 **`sonner-presenter.test.ts` 4 fail만**(구 모델 소비: `userMessageKey` getter/`isDomainError`). `sentry-reporter`는 P3c가 로컬 게이트로 green 유지(1 pass).

## 다음 단계 (재개 지점)
세션 끝에서 사용자에게 **"P3e로 계속 vs 일단락"**을 물었고 답 대기 중. 먼저 그걸 확인할 것.

- **P3d(정책 파이프라인 은퇴)** — handle-error/handler/types는 **P3b-ii에서 이미 선행 완료**. 잔여(구 `Reporter`/`Presenter`/`Notifier` 인터페이스)는 error-adapters(P6)와 결합 → 별도 단계 거의 불필요, P6/P3e로 흡수.
- **P3e(삭제 엔드게임)** — 순서 제약 주의:
  - **지금 안전히 삭제 가능**: `active-registry.ts`(ALS), 구 `app-error.ts`의 `DomainError` 클래스+정책 getter+`resolvePolicy`/`ResolvedPolicy`/`ResolvedAppError`/`isExpectedCode`/구 guards/`ClientSerializedError`, `per-request-isolation.test.ts`(삭제), `registry-invariants.test.ts`(재앵커). 단 **grep 게이트로 error-core 내 live importer 0 확인 후** 삭제.
  - **P6 후로 보류해야**: `schema.ts`(make-error가 zod `ErrorDetailsSchema`를 과도기 사용 중 — 먼저 make-error를 `semantics.validateDetails`로 옮겨야), 구 `Reporter/Presenter/Notifier` 인터페이스+`console-reporter.ts`+`composite.ts`(error-adapters가 구현·소비), `registry.ts`(ErrorCode union은 `decision/codes.ts`로 이미 이동했으나 ErrorMeta 등 잔여 소비 확인 필요).
- 이후: **P4**(error-react 추출: ErrorSurface/hooks/ErrorBoundary) · **P5**(error-next un-red — 새 `createErrorResponder`/`degrade`/`DecisionResult`/`AppError` 채택, `safe-*`가 코어 generic 감싸기, `HandleErrorSystem` variance 재검토) · **P6**(error-adapters un-red — sonner-presenter를 decision messageKey 경로로, sentry 로컬 게이트 정리) · **P7**(가드레일 ESLint+CI — RFC §8, 현재 전무) · **P8**(apps/error-architecture 도그푸딩, `error-decision-system` 패키지+`apps/error-decision-next` 은퇴, README/문서 단일화).

## 실행 방식 (이 작업의 리듬 — 유지할 것)
각 phase: **계획 작성(writing-plans) → 커밋 → subagent-driven 구현(Agent tool, 작업마다 1 implementer) → 2단계 리뷰(spec-compliance → code-quality, 독립 서브에이전트) → fix 서브에이전트 → 완료 마킹.** 위험/포팅 무거운 작업은 opus, 기계적이면 sonnet. 각 커밋은 TDD(red→green). per-package green 게이트.

## 핵심 gotcha / 발견 (반복 방지)
- **`SendMessage` 도구 미가용** — 이전 서브에이전트 이어가기 불가. fix는 항상 **새 서브에이전트**에 정확한 지시로 디스패치.
- **error-adapters는 구 모델의 *소비자***(sonner-presenter가 `userMessageKey` getter/`isDomainError` 사용) — "adapters는 sink 구현체일 뿐 green 유지" 가정이 P3b-ii에서 틀렸음. adapters도 red, P6에서 해소.
- **`sentry-reporter.ts`**가 삭제된 `serialize-client`의 `gateClientDetails`를 deep-import했었음 → P3c가 `CANONICAL_ERROR_SEMANTICS` 기반 **로컬 게이트로 동작-동일 교체**(P6 정리 대상). redaction/PII 동작 보존.
- **`make-error.ts`는 아직 zod `schema.ts` 사용**(과도기) — `schema.ts` 삭제 전 제거 필요.
- **D1 `validateDetails`는 카탈로그의 VALIDATION/RATE_LIMITED에만** 작성됨 → 그 둘만 `sys.fail` per-code 컴파일 타이핑 활성. 다른 코드 추가는 후속.
- **`HandleErrorSystem = Pick<DecisionSystem, ...>`**(handle-error.ts) — `DecisionSystem<구체카탈로그>`가 `<ErrorCatalog>`에 비할당(catalog-typed fail/appError 반변성) 회피용. P5 소비자 배선 시 재검토.
- 구 `construct`/`DomainError`는 `app-error.ts`에 **P3e까지 잔존**(composite.test 등이 fixture로 사용).
- **누출 게이트는 보안 load-bearing** — 유일 경로 `decision/system.toClientErrorPayload`(surface/target 미전송, 단일 `semantics.detailsAllowlist`, 전체 AppError 미직렬화). 어떤 변경도 이 불변식 약화 금지. `serialize-client.test.ts`(이전됨)가 15코드 검증.

## 다음 세션 추천 스킬
- `superpowers:writing-plans` — P3e(및 이후) 계획 작성.
- `superpowers:subagent-driven-development` — 구현 실행(이 작업의 표준 방식).
- `superpowers:test-driven-development` — 디스패치하는 서브에이전트가 따를 것.
- (전체 완료 후) `superpowers:finishing-a-development-branch` — p3a 브랜치 → main 머지/PR.

## 사용자 메모
- 항상 **한국어**로 응답. git 커밋에 **co-author 추가 금지**.
