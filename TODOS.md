# TODOS

## @sentry/nextjs devDep 8.x → next 16 공식 지원 메이저로 업그레이드

- **What:** `packages/error-adapters`의 `@sentry/nextjs` devDep(현재 ^8.50, 설치 8.55.2)을 next 16을 peer로 지원하는 메이저로 올리고, `sentry-reporter.ts`의 v8 콜백-스코프 가정(`withScope(callback)`, `captureException(err, scope-callback)`)을 신 SDK API로 재검토.
- **Why:** (1) 현재 `pnpm peers check`의 unmet peer 경고(8.x는 next ^13-15만 지원)가 상존. (2) 이식 설계(2026-06-06 design doc)의 전제 3이 "대상 Sentry SDK major !== 8이면 thin-sink 강등(~100-150줄 재작성)"을 하드 트리거로 두는데, 업그레이드하면 이 강등 분기 자체가 사라짐.
- **Pros:** 이식 시 C 강등 확률 감소, peer 경고 제거, 레퍼런스 레포로서의 최신성.
- **Cons:** sentry-reporter 테스트(adapters 21개 중 sentry 분량)가 v8 API 형태에 의존 — 테스트 재작성 동반. CC 기준 ~1-2시간.
- **Context:** 완전성 감사(2026-06-06)에서 발견. 이식 eng-review(D10)에서 "인벤토리 결과에 따라 승격" 조건부 TODO로 확정. Phase 0b(마커+beforeSend 합성 헬퍼)가 sentry 경로를 어차피 만지므로 병합 후보.
- **승격 조건:** 대상 모노레포 인벤토리 사실 4(Sentry SDK 버전)가 v8이 **아니면** Phase 0에 합류시켜 즉시 수행. v8이면 후순위 유지.
- **Depends on / blocked by:** PR #2(수렴 머지) 후 깨끗한 base에서 수행 권장. Phase 0b와 같은 파일을 만지므로 동시 진행 시 같은 브랜치로.
