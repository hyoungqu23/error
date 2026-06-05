// error-core/decision/types.ts — 결정 어휘(순수 데이터 타입). DomainError/React/Next 무관.
// 출처: error-decision-system/src/index.ts:1-133
import type { AppError } from "./app-error";

export type ErrorCategory = "business" | "operational" | "fault";

export type ErrorSensitivity =
  | "public"
  | "auth"
  | "permission"
  | "pii"
  | "business-sensitive"
  | "internal";

export type InteractionKind =
  | "page-load"
  | "query"
  | "mutation"
  | "form-submit"
  | "background-sync"
  | "route-guard"
  | "event-handler"
  | "render";

export type UiScope =
  | "field"
  | "form"
  | "component"
  | "panel"
  | "page"
  | "session"
  | "background";

export type Criticality = "low" | "normal" | "core" | "revenue" | "security";
export type DisclosureLevel = "specific" | "safe-vague" | "generic" | "support-only";

export type UserAction =
  | "fix-input"
  | "retry"
  | "login"
  | "request-access"
  | "choose-different-option"
  | "wait"
  | "go-back"
  | "contact-support"
  | "none";

export type ErrorSurface =
  | "field"
  | "form"
  | "inline"
  | "empty"
  | "toast"
  | "dialog"
  | "page"
  | "redirect"
  | "silent";

export interface TelemetryDecision {
  capture: boolean;
  level: "info" | "warning" | "error" | "fatal";
  breadcrumb: boolean;
  alert: boolean;
  sampleRate?: number;
  fingerprint?: readonly string[];
  tags?: Record<string, string>;
}

export interface ErrorSemantics<Code extends string = string, Details = unknown> {
  code: Code;
  category: ErrorCategory;
  sensitivity: ErrorSensitivity;
  defaultHttpStatus: number;
  defaultRetryable: boolean;
  defaultMessageKey: string;
  messageKeys?: Partial<Record<DisclosureLevel, string>>;
  disclosureByUiScope?: Partial<Record<UiScope, DisclosureLevel>>;
  disclosureByResource?: Partial<Record<string, DisclosureLevel>>;
  actionByResource?: Partial<Record<string, UserAction>>;
  defaultAction?: UserAction;
  actionByUiScope?: Partial<Record<UiScope, UserAction>>;
  actionByInteraction?: Partial<Record<InteractionKind, UserAction>>;
  surfaceByResource?: Partial<Record<string, ErrorSurface>>;
  telemetryBySurface?: Partial<Record<ErrorSurface, Partial<TelemetryDecision>>>;
  redirectTarget?: string;
  detailsExposure: "none" | "allowlist";
  detailsAllowlist?: readonly string[];
  validateDetails?: (details: unknown) => details is Details;
}

export interface OperationMeta<Operation extends string = string> {
  operation: Operation;
  owner: string;
  criticality: Criticality;
  defaultUiScope: UiScope;
  piiRisk: boolean;
}

export interface OccurrenceContext<Operation extends string = string> {
  operation: Operation;
  interaction: InteractionKind;
  uiScope: UiScope;
  criticality: Criticality;
  fieldPath?: string;
  resource?: string;
  userCanRetry?: boolean;
  idempotent?: boolean;
  background?: boolean;
}

export interface RuntimeContext {
  runtime: "server" | "client";
  route?: string;
  user?: { id: string; role?: string } | null;
  correlationId?: string;
  traceId?: string;
}

/** i18n 보간 인자. translator.ts의 TranslateVars와 구조 동일(순환 import 회피). */
export type TranslateVars = Record<string, string | number>;

export interface UserErrorDecision {
  surface: ErrorSurface;
  disclosure: DisclosureLevel;
  messageKey: string;
  messageVars?: TranslateVars; // §5.4 — 보간 인자(render-time 도출; D5)
  action: UserAction;
  target?: string;
  supportCode?: string;
  retryAfterMs?: number;
}

/** 서버→클라 경계를 넘는 단 하나의 DTO(§5.3). surface/target은 절대 싣지 않는다. */
export interface ClientErrorPayload {
  code: string;
  messageKey: string;
  messageVars?: TranslateVars;
  disclosure: DisclosureLevel;
  action: UserAction; // §5.3: required
  supportCode?: string;
  retryAfterMs?: number;
  correlationId?: string; // 구 error-core 보존
  digest?: string; // RSC 경계용 보존
  details?: unknown; // 단일 allowlist 통과분만
}

export interface ErrorDecision {
  user: UserErrorDecision;
  telemetry: TelemetryDecision;
}

export type ErrorCatalog = Record<string, ErrorSemantics>;
export type OperationCatalog = Record<string, OperationMeta>;

export interface TelemetryContext extends RuntimeContext {
  operation: string;
}
export interface ReporterSink {
  capture(error: AppError, decision: TelemetryDecision, ctx: TelemetryContext): void;
  breadcrumb(error: AppError, decision: TelemetryDecision, ctx: TelemetryContext): void;
}
export interface NotifierSink {
  alert(error: AppError, decision: TelemetryDecision, ctx: TelemetryContext): void;
}

/**
 * 신 모델의 3번째 sink 계약(RFC 모듈 맵) — 단 파이프라인(executeErrorDecision)은 호출하지
 * 않는다: presentation은 소비자/UI의 몫이므로, caller가 반환받은 UserErrorDecision을
 * presenter에 넘긴다. 벤더 어댑터(sonner 등)가 구현하는 표면 계약일 뿐이다. (P6)
 */
export interface Presenter {
  present(error: AppError, user: UserErrorDecision, ctx: TelemetryContext): void;
}
