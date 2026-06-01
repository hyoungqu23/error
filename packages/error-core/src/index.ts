// error-core — 프레임워크·벤더 무관 에러 커널의 공개 표면.
//
// 이 배럴은 클라이언트 번들에서 평가해도 안전한 것만 노출한다(NO "server-only",
// NO next/*, NO react, NO 벤더 SDK). React/Next 통합은 `error-next`,
// Sentry/sonner/pager 벤더 어댑터는 `error-adapters`에 있다.
//
// 세부 모듈은 deep import도 가능하다: `import { … } from "error-core/app-error"`.

// ── 에러 모델 + 식별 ────────────────────────────────────────────────────────
export { makeError, unknownCodeForRuntime } from "./make-error";
export {
  DomainError,
  isDomainError,
  isSerializedError,
  isClientSerializedError,
  isExpectedCode,
  resolvePolicy,
  type AppError,
  type AppErrorOptions,
  type SerializedError,
  type ClientSerializedError,
  type ResolvedPolicy,
  type ResolvedAppError,
} from "./app-error";

// ── 레지스트리(SSOT) + 스키마 + 어휘 ────────────────────────────────────────
export { DEFAULT_ERROR_REGISTRY, type ErrorCode, type ErrorMeta, type ErrorRegistry } from "./registry";
export { ErrorDetailsSchema, type ErrorDetailsMap } from "./schema";
export type { Severity } from "./severity";
export type { PresentAction, LogLevel, HttpStatus, ErrorKind } from "./policy";
export { getRuntime, type Runtime } from "./runtime";
export {
  getActiveErrorRegistry,
  setActiveErrorRegistry,
  runWithErrorRegistry,
} from "./active-registry";

// ── 직렬화 안전 Result 계약 + 클라이언트 누출 게이트 ────────────────────────
export { actionSuccess, actionFailure, type Result, type Success, type Failure } from "./result";
export {
  toClientSerialized,
  gateClientDetails,
  DETAILS_ALLOWLIST,
} from "./serialize-client";

// ── i18n / 메시지 해소 ──────────────────────────────────────────────────────
export {
  resolveErrorMessage,
  createFallbackTranslator,
  FALLBACK_MESSAGES,
  type Translator,
  type TranslateVars,
} from "./translator";

// ── 텔레메트리 계약 + 단일 처리 경로 (컴포지션 루트/어댑터용) ───────────────
export type { Reporter, Presenter, TelemetryContext } from "./telemetry";
export type { HandleErrorDeps } from "./types";
export { createHandleError, type HandleErrorOptions } from "./handle-error";
export {
  noopNotifier,
  compositeNotifier,
  policyGatedNotifier,
  thresholdAlertPolicy,
  compareSeverity,
  type Notifier,
  type AlertPolicy,
  type ThresholdPolicyOptions,
} from "./notifier";

// ── 순수 리포터 어댑터 (벤더 SDK 없음) ──────────────────────────────────────
export {
  guardedCompositeReporter,
  compositeReporter,
  noopReporter,
  type GuardedCompositeReporter,
  type ReporterHealth,
  type LabeledReporter,
  type CompositeReporterOptions,
} from "./adapters/composite";
export { createConsoleReporter } from "./adapters/console-reporter";

// ── 정규화 + 헬퍼 ───────────────────────────────────────────────────────────
export { normalizeToDomainError } from "./normalize";
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
export { toErrorResponse } from "./route-handler";

// ── 클라이언트 싱글턴 sink + 진입점 (react/next 의존 없음) ──────────────────
export { initHandleError, handleError, setErrorUser } from "./handler";
export { safeHandler } from "./safe-handler";
export { initBrowserBoundary } from "./browser-boundary";
