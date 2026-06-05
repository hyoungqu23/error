// error-core — 프레임워크·벤더 무관 에러 커널의 공개 표면.
//
// 이 배럴은 클라이언트 번들에서 평가해도 안전한 것만 노출한다(NO "server-only",
// NO next/*, NO react, NO 벤더 SDK). React/Next 통합은 `error-next`,
// Sentry/sonner/pager 벤더 어댑터는 `error-adapters`에 있다.
//
// 세부 모듈은 deep import도 가능하다: `import { … } from "error-core/decision/app-error"`.

// ── 에러 모델 + 식별 ────────────────────────────────────────────────────────
// 통합 모델(AppError 클래스·appError·isAppError·SerializedError·isSerializedError·
// ClientErrorPayload·isClientErrorPayload·ErrorCode·KNOWN_ERROR_CODES·isKnownErrorCode·
// CANONICAL_ERROR_SEMANTICS 등)은 전부 `export * from "./decision"`로 노출된다(파일 하단).
export { makeError, unknownCodeForRuntime } from "./make-error";

// ── 런타임 감지 ─────────────────────────────────────────────────────────────
export { getRuntime, type Runtime } from "./runtime";

// ── 직렬화 안전 Result 계약(wire) + 누출 게이트는 decision/system toClientErrorPayload로 일원화 ──
export {
  actionSuccess,
  degrade,
  type Result,
  type Success,
  type Failure,
  type DecisionResult,
  type DecisionFailure,
} from "./result";

// ── i18n / 메시지 해소 ──────────────────────────────────────────────────────
export {
  resolveErrorMessage,
  createFallbackTranslator,
  FALLBACK_MESSAGES,
  type Translator,
  type TranslateVars,
} from "./translator";

// ── 텔레메트리 계약 + 단일 처리 경로 (컴포지션 루트/어댑터용) ───────────────
// (TelemetryContext/ReporterSink/NotifierSink/Presenter/TelemetryDecision 등은
//  `export * from "./decision"`로 노출)
export type { HandleErrorDeps } from "./types";
export { createHandleError, type HandleErrorOptions } from "./handle-error";

// ── 순수 리포터 어댑터 (벤더 SDK 없음) — dead-man's-switch (P6 재도입) ──────
export {
  guardedCompositeReporter,
  compositeReporter,
  noopReporter,
  type GuardedCompositeReporter,
  type ReporterHealth,
  type LabeledReporter,
  type CompositeReporterOptions,
} from "./adapters/composite";

// ── 정규화 + 헬퍼 ───────────────────────────────────────────────────────────
export { normalizeToAppError } from "./normalize";
export { fieldErrorsFromError } from "./field-errors";

// ── 재시도 정책(순수) + 네트워크 경계(isomorphic) ──────────────────────────
export {
  computeRetryDelay,
  exponentialBackoffWithJitter,
  DEFAULT_BACKOFF,
  type BackoffConfig,
} from "./backoff";
export { parseRetryAfter, retryAfterHintFromError } from "./retry-after";
export { networkBoundary, type NetworkBoundaryOptions } from "./network-boundary";
export { createErrorResponder } from "./route-handler";

// ── 클라이언트 싱글턴 sink + 진입점 (react/next 의존 없음) ──────────────────
export { initHandleError, handleError, setErrorUser } from "./handler";
export { safeHandler } from "./safe-handler";
export { initBrowserBoundary } from "./browser-boundary";
export * from "./decision";
