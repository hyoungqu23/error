## 요약

<!-- 무엇을, 왜 바꿨는지 한두 문단 -->

## 체크리스트 — error-system 가드레일 (RFC §8)

- [ ] 게이트 green: `pnpm turbo run typecheck test lint` (워크스페이스 전체 — P8 수렴 종결 기준)
- [ ] **누출게이트 불변**: 서버→클라 wire는 `toClientErrorPayload`(단일 allowlist 게이트)만 — 새 직렬화 경로를 추가하지 않았다
- [ ] 카탈로그(`CANONICAL_ERROR_SEMANTICS`) 변경 시: `catalog-invariants`/`pii-invariants` 테스트를 함께 갱신했고, `detailsExposure`/`sensitivity` 축을 보안 관점에서 리뷰했다
- [ ] 벤더 SDK(`@sentry/*`, `sonner`, pager) import는 `error-adapters`에만 추가했다 (ESLint가 강제하지만 의도 확인)
- [ ] 사용자 노출 카피는 raw `error.message`/i18n 키가 아니라 `resolveErrorMessage(messageKey)` 경유로 렌더된다
- [ ] (커널 breaking 변경 시) 다운스트림 red 전환 여부를 해당 phase 계획 문서에 기록했다
