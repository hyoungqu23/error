# 이식 가이드 — packages/error-* 를 프로덕션 모노레포로 (no-publish, fork-and-own)

> 원본 설계·리뷰 기록: `~/.gstack/projects/hyoungqu23-error/hyoungmin-main-design-20260606-020906.md`
> (office-hours APPROVED → plan-eng-review ENG CLEARED, Codex cold read ×2 포함).
> 이 문서는 그 설계의 **실행용 압축본**이다 — 대상 모노레포에서 이 파일만 보고 이식할 수 있어야 한다.

## 상태

- [x] **Phase 0 (원본 선행 작업) — 완료** (PR #3, main `876b9c7`, 2026-06-06)
  - [x] 0a: `safeFormAction`/`safeServerAction` validator-agnostic — `FormValidator` 계약 + `zodFormValidator` + `toWireFieldErrors`(`_form` 합류)
  - [x] 0b: Sentry 이중 캡처 마커 — `markPipelineCaptured`(원본 input, capture **실제 실행** 시에만) + `composeBeforeSend`(①마커드롭→②기존 beforeSend→③PII 스크럽)
  - [x] 테스트 391 / 게이트 typecheck·test·lint·build 12/12
- [ ] 대상 10-사실 인벤토리 (아래)
- [ ] PR1 — 복사 + workspace 등록 + **CI 게이트 결합(완료 조건)**
- [ ] PR2a — 관측 배선 (Sentry 합성 + 컴포지션 루트 + ESLint 가드레일; 폼 코드 무접촉)
- [ ] PR2b — 가치 증명 (폼 액션 1곳 전환 + E2E)

## 0. 대상 10-사실 인벤토리 (이식 코드를 만지기 전, ~1-2시간)

- [ ] 1. Next.js 버전 — **≥15.1?** (미만이면 error-next 반입 불가 → core+adapters 선행 후 후속)
- [ ] 2. React 버전 — 19?
- [ ] 3. 패키지 매니저 — `workspace:*` 프로토콜 지원? (npm/yarn classic은 미지원 → deps 표기 치환 필요)
- [ ] 4. `@sentry/*` SDK 패키지명·버전·기존 beforeSend 존재 여부 — **v8 아니면 아래 강등 트리거 참조**
- [ ] 5. @tanstack/react-query 버전 — v5?
- [ ] 6. `error-core`/`error-adapters`/`error-next` 패키지명 충돌 또는 `@org/*` 스코프 규약? (bare cross-import 27곳 — rename 시 import+tsconfig paths+vitest alias 일괄 치환)
- [ ] 7. ESLint 메이저 + flat-config? / pnpm·Node 버전 (pnpm 11 = Node ≥22.13)
- [ ] 8. `.npmrc` — `strict-peer-dependencies` **및** `auto-install-peers` (이 레포는 auto-install=true+strict=false에 의존)
- [ ] 9. 에러 라우트·라우트 가드 경계 — `/login`·`/403`·`error.tsx` 존재? 기존 RouteGuard의 리다이렉트 규약 vs `useErrorHandler` 하드 매핑(AUTH_REQUIRED→`/login?returnTo`, FORBIDDEN→`/403`) 충돌?
- [ ] 10. 폼 검증 스택(zod? — `FormValidator` 어댑터를 어느 라이브러리용으로 쓸지) + **대상 도메인 PII 민감 필드**(카탈로그 allowlist·스크럽이 대상 기준으로도 안전한지)

정적으로 확인 안 되는 항목(peer 해소·CI 거동)은 PR1을 **드래프트로 올려 대상 CI 드라이런**으로 확인.

## 1. PR1 — 기계적 반입 (기존 코드 무접촉)

- [ ] 패키지명 결정 — 충돌/스코프 규약 시 복사 직후 일괄 rename (typecheck가 누락을 잡음)
- [ ] `packages/error-core/`, `packages/error-adapters/`, `packages/error-next/` 디렉터리 복사
  - 포함: 각 `__tests__/`, `vitest.config.ts` ×3, `test/server-only-stub.ts` ×2, **패키지 로컬 tsconfig**(`baseUrl`+`paths`가 load-bearing — 루트에 의존시키지 말 것)
  - 제외: `apps/`, `docs/`, 루트 lockfile, turbo.json(대상이 turbo면 태스크 정의만 차용)
- [ ] `pnpm-workspace.yaml`에 경로 등록 → `pnpm install`로 lockfile 재생성
- [ ] tsconfig 정합 — `moduleResolution: "bundler"`, `module: "ESNext"`, `strict`, `isolatedModules`
- [ ] 의존성 — zod(core), `server-only`(**dependencies** — `import "server-only"` 7곳), error-next peers(next/react/react-dom/@tanstack), optional peers(sonner — 토스트 채택 시)
- [ ] **대상 CI에 반입 패키지 typecheck/test/lint 태스크 추가 — PR1 완료 조건** (391은 "패키지 무결성 게이트"이며 통합 게이트가 아님 — 통합은 PR2b의 E2E)
- 롤백: 디렉터리 삭제 + CI 태스크 제거 한 번

## 2. PR2a — 관측 배선 (기존 에러 흐름 무변경이 완료 기준)

- [ ] **Sentry v8 호환 확인 — 강등 트리거(하드 기준, 하나라도 실패 시 thin-sink로)**:
  ① `@sentry/nextjs` major === 8 ② `Sentry.withScope(callback)` 시그니처 타입체크 통과 ③ `captureException(err, scope-callback)` 오버로드 존재
  - 강등 시: ReporterSink(capture/breadcrumb) ~100-150줄 직접 구현하되 스크럽은 `pickAllowlistedDetails`/`sentryBeforeSend` **재사용 강제**(신규 스크럽 작성 금지)
- [ ] 기존 Sentry init의 beforeSend를 `composeBeforeSend(existing)`으로 교체 — 순서 계약: ①마커드롭 ②기존(null 단락) ③스크럽
- [ ] `createSentryReporter()`를 `guardedCompositeReporter`로 감싸 dead-man's-switch 유지
- [ ] 컴포지션 루트 — **클라**: `apps/error-architecture/lib/composition-root.ts` 원형(`clientErrorSystem` 주입) / **서버**: 파일 공유 없이 `error-next/server`의 `serverDeps` 직접 import
- [ ] ESLint 벤더 격리 룰 이식(직접 Sentry import 금지, `{error.message}` 렌더 금지) + 대상 instrumentation 파일 예외
- 완료 기준: 기존 Sentry 이벤트 흐름 무변경 + 반입 테스트 green. 실패 시 PR1은 유지 가능(미사용 패키지 무해)

## 3. PR2b — 가치 증명

- [ ] 폼 액션 1곳 전환 — zod면 `safeFormAction(schema, ...)` 직행 / 비zod면 해당 라이브러리용 `FormValidator` 어댑터 작성(신뢰 계약: fieldErrors/formError는 **콘텐츠 무검사로 wire 직행** — 사용자-대면 안전 카피만)
- [ ] E2E: VALIDATION → 필드 인라인 / unexpected → error.tsx + **Sentry 정확히 1건**(deterministic test transport/mock으로 단정 — 실서버 Sentry 의존 금지)
- [ ] PR 설명에 before/after 명시 — 확산은 팀의 몫
- 백로그: 2번째 전환은 1번째와 **다른 패턴**의 폼으로(파일 업로드·다단계 등)

## 성공 기준

- 반입 게이트: 대상에서 typecheck + 391 테스트 + lint + 대상 앱 빌드 green
- Sentry: 기존 beforeSend 동작 유지 / [리스크 지표] 전환 폼 에러 1회 캡처(이중 보고 dedupe는 Phase 0b 마커가 담당 — 첫 측정 2건이면 PR2a 미완으로 처리)
- 누출게이트: 해당 슬라이스 wire 응답에 `message` 필드 부재 + details는 allowlist만
- 팀: 첫 PR 1주 내 머지(리뷰 정체 모니터링)

## 알려진 함정 (원본 리뷰에서 검증됨)

1. `createSentryReporter`는 클라이언트 래핑이 아니라 **글로벌 `@sentry/nextjs` v8 API 직접 호출** — 호환 확인이 선행
2. bare 패키지명 cross-import 27곳 — rename은 일괄 치환
3. `server-only`가 **dependencies**(7 import sites) — 누락 시 즉시 깨짐
4. 패키지 로컬 tsconfig `paths`가 load-bearing
5. `.npmrc` `auto-install-peers=true` 의존 — 대상에서 꺼져 있으면 필수 peer도 설치 안 됨
6. 자동캡처↔파이프라인 dedupe는 Phase 0b 마커가 해결(범용 dedupe 시스템 만들지 말 것) — 마킹은 capture **실제 실행** 시에만(sample-out·sink-throw 시 자동 캡처가 안전망)
