# P7 — 가드레일 레이어 (ESLint + CI + PII 불변식) Implementation Plan

> RFC §8. 현재 enforcement 전무(.eslintrc* 0, 패키지 lint 0 → `turbo run lint` no-op, CI 0). 게이트: 3패키지(core/adapters/next) typecheck+test+**lint** green + CI 워크플로우 유효.

**Goal:** RFC §8의 가드레일 5항목을 구축한다 — (1) ESLint flat-config(벤더 SDK 직접 import 금지 + 위험 구문 금지), (2) 패키지별 lint 스크립트로 `turbo run lint` 실효화, (3) CI 게이트 + PR 체크리스트, (4) §8-4 불변식 이전 **확인**(이미 충족 — 기록), (5) PII 불변식 테스트(커널 산출 단계).

**Architecture (잠긴 결정):**
- **D-P7-1 (ESLint 9 flat-config, 루트 단일):** `eslint.config.mjs` + devDeps `eslint`/`typescript-eslint`(워크스페이스 루트 -w). 파서는 typescript-eslint(타입 미사용 룰만 — 빠른 lint, 타입체크는 tsc 게이트가 담당).
  - `no-restricted-imports`: `sonner`·`@sentry/*` — **error-adapters만 허용**(벤더 격리 원칙). 컴포지션 루트 허용은 P8에서 apps를 lint에 편입할 때 파일 패턴 오버라이드로 추가(`apps/**/composition-root.ts`, `apps/**/instrumentation*`, Toaster 마운트 지점).
  - `no-restricted-syntax`: ① `Sentry.captureException(...)` 직접 호출(어댑터 외) ② JSX에서 `{error.message}` 직접 렌더(`e|err|error` 식별자 한정 — 오탐 억제) ③ `toast(...)` 인자에 `.message` 접근. 금지 메시지에 대체 경로(handleError/ErrorFallback/resolveErrorMessage) 명시.
  - **테스트 파일(`**/__tests__/**`, `*.test.*`)과 error-adapters 소스는 벤더 룰 제외**(어댑터 본체 + SDK mock).
- **D-P7-2 (lint 스코프 = packages, apps는 P8 편입):** lint 스크립트는 `error-core`/`error-adapters`/`error-next` 3곳(`eslint .`). `error-decision-system`(P8 은퇴)·`apps/*`(P8 마이그레이션)는 P7에서 제외 — eslint.config에는 전역 규칙을 두되 ignores로 명시 제외 + P8 TODO 주석.
- **D-P7-3 (CI):** `.github/workflows/ci.yml` — pnpm + node 20, `turbo run typecheck test lint --filter=error-core --filter=error-adapters --filter=error-next`(P8 전까지 apps/error-decision-system 제외 — 주석 명시). PR 템플릿 `.github/pull_request_template.md`: 게이트 green·누출게이트 불변(toClientErrorPayload 단일)·카탈로그 변경 시 catalog-invariants 갱신·벤더 import는 어댑터만 체크리스트.
- **D-P7-4 (§8-4 확인):** validateCatalog(decision-validate.test)·시나리오 매트릭스(decision-system/decision-resolve.test)·i18n key-echo(i18n-completeness.test)·catalog invariants(catalog-invariants.test)·precedence/finalizeFailure fieldPath(decision-system.test:126,145) — **전부 error-core에 이미 존재. 추가 작업 없음(기록).**
- **D-P7-5 (PII 불변식 테스트, §8-5):** error-core `__tests__/pii-invariants.test.ts` 신설 —
  ① 카탈로그 정적: 15코드 defaultMessageKey/messageKeys·FALLBACK_MESSAGES 값에 PII 패턴(이메일/토큰/Bearer) 부재.
  ② 산출 단계: PII가 든 message/details로 resolveErrorDecision을 돌려 `telemetry.fingerprint`/`telemetry.tags`에 그 문자열이 **절대 새지 않음**(고정 어휘 — operation/criticality/surface/runtime/code/interaction만).
  ③ wire: toClientErrorPayload 결과에 `message` 키 자체가 없음 + PII details가 allowlist 밖이면 부재(기존 serialize-client 보강 단언).
  (OperationMeta.piiRisk의 결정-엔진 활용은 resolve가 아직 안 읽음 — 후속 백로그로 기록.)

## Tasks
- **T1:** devDeps 설치 + `eslint.config.mjs` + 3패키지 lint 스크립트 → `pnpm lint`(turbo) green. 기존 코드 위반은 규칙을 깎지 말고 코드를 고친다(단 의도적 사용은 파일 오버라이드).
- **T2:** PII 불변식 테스트(D-P7-5) → error-core 게이트 green.
- **T3:** CI 워크플로우 + PR 템플릿(D-P7-3).
- **T4:** 최종 게이트(3패키지 typecheck+test+lint) + 적대적 리뷰.

## Self-Review
- RFC §8 1~5 전 항목 매핑: 1→T1, 2→T1, 3→T3, 4→D-P7-4(기록), 5→T2. ✓
- lint가 P8 작업(apps 편입·컴포지션 루트 허용 목록)을 막지 않도록 ignores/주석으로 이연 지점 명시. ✓
- 게이트에 lint가 추가되어도 기존 typecheck/test 게이트는 불변. ✓
