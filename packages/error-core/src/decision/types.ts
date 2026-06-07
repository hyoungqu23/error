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
  /**
   * 불투명한 요청/트레이스 식별자(UUID·request-id)여야 한다 — 사용자 식별자/PII 금지.
   * fault 계열에서 supportCode로 ClientErrorPayload(wire)에 노출된다(resolve §5.3).
   */
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
  /**
   * 캡처 반환 프로토콜(이중 캡처 마커 dedupe의 입력) — 의미론은 "마커를 소비하는 원격 관측
   * transport(현재 Sentry)에 이벤트가 실제로 도달했는가"다:
   *   - `true`  = pipeline-capture 마커를 소비하는 원격 관측 transport(현재 Sentry)로 실제
   *               전송됨. → 파이프라인이 dedupe 마킹을 한다(자동 캡처 중복본 드롭). dedupe 마킹을
   *               원하는 커스텀 원격 sink는 반드시 `true`를 반환해야 한다.
   *   - `false` = 실행은 됐으나 의도적 드롭(throttle-drop 등)·전송 실패, 또는 원격 전송이 아닌
   *               sink(console/noop). → 파이프라인은 마킹하지 않는다.
   *   - `undefined`(legacy void 구현) = "전송 주장 없음" → 비마킹. (Codex P1: 과거엔 undefined를
   *               전송으로 간주했으나, 그러면 composite에 void sink 하나만 끼어도 Sentry의
   *               throttle-drop(false)을 깔아뭉개 마킹→자동 캡처본 드롭→스톰 시 이벤트 0건이
   *               부활했다. 이제 명시적 true만 전송으로 본다.) 마커의 유일한 소비자는
   *               composeBeforeSend(Sentry)이므로 마킹이 안 되면 최악은 자동 캡처와의 중복 1건이지
   *               이벤트 0건이 아니다(가시성 fail-open).
   *
   * composite 집계는 OR다(adapters/composite.ts): 어느 한 sink라도 명시적 true를 반환했으면
   * composite도 "전송됨"(true)을 반환한다. 불변식 — 비-원격 sink(console/noop: 항상 false)나
   * legacy void sink(undefined)는 같은 composite의 원격 sink(Sentry: true) 마킹을 깔아뭉개지
   * 않는다. 멀티 원격 sink 구성 시 케이빗: 마커를 실제로 소비(자동 캡처본 드롭)하는 곳은 Sentry
   * beforeSend 한 곳뿐이므로, true는 마커 소비자(Sentry) 전송에만 의미가 있다. 가시성(전송 실패
   * 가시화)은 별개로 guardedCompositeReporter의 throw 카운트(health())가 담당한다.
   */
  capture(error: AppError, decision: TelemetryDecision, ctx: TelemetryContext): void | boolean;
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
