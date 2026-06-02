// error-core/decision/resolve.ts — 순수 결정 resolver. 통합 AppError(P3)에 결합하지 않도록
// 구조적 DecisionError에만 의존한다. 함수 본문은 error-decision-system/src/index.ts에서 이식.
import type {
  ErrorSemantics, OccurrenceContext, RuntimeContext,
  UserErrorDecision, TelemetryDecision, ErrorDecision,
  DisclosureLevel, UserAction, ErrorSurface,
} from "./types";

/** resolver가 에러에서 읽는 최소 구조. P3에서 AppError가 이 형태를 구조적으로 만족한다. */
export interface DecisionError {
  code: string;
  retryAfterMs?: number;
  userCanRetry?: boolean;
  details?: unknown;
}

export interface ErrorDecisionInput {
  error: DecisionError;
  semantics: ErrorSemantics;
  occurrence: OccurrenceContext;
  runtime: RuntimeContext;
}

const resolveDisclosure = (semantics: ErrorSemantics, occurrence: OccurrenceContext): DisclosureLevel => {
  if (occurrence.resource) {
    const resourceDisclosure = semantics.disclosureByResource?.[occurrence.resource];
    if (resourceDisclosure) return resourceDisclosure;
  }
  const scopedDisclosure = semantics.disclosureByUiScope?.[occurrence.uiScope];
  if (scopedDisclosure) return scopedDisclosure;

  if (semantics.category === "fault") {
    return occurrence.criticality === "core" ||
      occurrence.criticality === "revenue" ||
      occurrence.criticality === "security"
      ? "support-only"
      : "generic";
  }
  switch (semantics.sensitivity) {
    case "public":
      return "specific";
    case "auth":
    case "permission":
    case "business-sensitive":
      return "safe-vague";
    case "pii":
      return occurrence.criticality === "security" ? "support-only" : "safe-vague";
    case "internal":
      return "generic";
  }
};

const resolveSurface = (
  _error: DecisionError,
  semantics: ErrorSemantics,
  occurrence: OccurrenceContext,
  action: UserAction,
): ErrorSurface => {
  if (occurrence.uiScope === "field" && occurrence.fieldPath) return "field";
  if (occurrence.interaction === "route-guard" && action === "login") return "redirect";
  // A non-idempotent submit that the system would otherwise let the user re-run must not
  // silently re-submit (double-charge / double-write). It needs an explicit user choice,
  // so it surfaces as a dialog rather than an inline form retry.
  if (
    (occurrence.interaction === "form-submit" || occurrence.interaction === "mutation") &&
    occurrence.idempotent === false &&
    (semantics.defaultRetryable || occurrence.userCanRetry === true)
  ) {
    return "dialog";
  }
  if (occurrence.interaction === "form-submit") return "form";
  if (occurrence.uiScope === "background" || occurrence.background) return "silent";
  if (occurrence.uiScope === "page" || occurrence.uiScope === "session") return "page";
  if (occurrence.resource) {
    const resourceSurface = semantics.surfaceByResource?.[occurrence.resource];
    if (resourceSurface) return resourceSurface;
  }
  if (semantics.category === "operational" && (occurrence.userCanRetry ?? semantics.defaultRetryable)) return "toast";
  return "inline";
};

// A retry-style action on a non-idempotent operation is unsafe (it would re-trigger the
// side effect). Such cases are downgraded to "wait" so the UI asks the user to confirm the
// outcome instead of blindly retrying.
const guardIdempotency = (action: UserAction, occurrence: OccurrenceContext): UserAction =>
  action === "retry" && occurrence.idempotent === false ? "wait" : action;

const resolveAction = (_error: DecisionError, semantics: ErrorSemantics, occurrence: OccurrenceContext): UserAction => {
  if (occurrence.resource) {
    const resourceAction = semantics.actionByResource?.[occurrence.resource];
    if (resourceAction) return guardIdempotency(resourceAction, occurrence);
  }
  const scopedAction = semantics.actionByUiScope?.[occurrence.uiScope];
  if (scopedAction) return guardIdempotency(scopedAction, occurrence);
  const interactionAction = semantics.actionByInteraction?.[occurrence.interaction];
  if (interactionAction) return guardIdempotency(interactionAction, occurrence);
  if (semantics.defaultAction) return guardIdempotency(semantics.defaultAction, occurrence);
  if (occurrence.userCanRetry ?? _error.userCanRetry ?? semantics.defaultRetryable) {
    return guardIdempotency("retry", occurrence);
  }
  if (semantics.category === "fault") return "contact-support";
  return "none";
};

const resolveMessageKey = (semantics: ErrorSemantics, disclosure: DisclosureLevel): string =>
  semantics.messageKeys?.[disclosure] ?? semantics.defaultMessageKey;

// `target` means different things per surface: the field to focus for `field`, the redirect
// path for `redirect`. Anything else has no target.
const resolveTarget = (
  semantics: ErrorSemantics,
  occurrence: OccurrenceContext,
  surface: ErrorSurface,
): string | undefined => {
  if (surface === "field") return occurrence.fieldPath;
  if (surface === "redirect") return semantics.redirectTarget;
  return undefined;
};

const resolveTelemetry = (
  error: DecisionError,
  semantics: ErrorSemantics,
  occurrence: OccurrenceContext,
  runtime: RuntimeContext,
  surface: ErrorSurface,
): TelemetryDecision => {
  const fingerprint = [occurrence.operation, error.code, occurrence.interaction];
  const tags = {
    operation: occurrence.operation,
    criticality: occurrence.criticality,
    surface,
    runtime: runtime.runtime,
  };

  const surfaceTelemetry = semantics.telemetryBySurface?.[surface];
  if (surfaceTelemetry) {
    return {
      capture: true,
      level: "info",
      breadcrumb: true,
      alert: false,
      fingerprint,
      tags,
      ...surfaceTelemetry,
    };
  }

  if (semantics.category === "business") {
    const important = occurrence.criticality === "revenue" || occurrence.criticality === "security";
    return {
      capture: important,
      level: important ? "warning" : "info",
      breadcrumb: true,
      alert: false,
      sampleRate: important ? 1 : 0.1,
      fingerprint,
      tags,
    };
  }

  if (semantics.category === "operational") {
    const important = occurrence.criticality === "revenue" || occurrence.criticality === "security";
    return {
      capture: important,
      level: important ? "warning" : "info",
      breadcrumb: surface !== "silent",
      alert: false,
      sampleRate: important ? 1 : 0.1,
      fingerprint,
      tags,
    };
  }

  const alert =
    runtime.runtime === "server" &&
    (occurrence.criticality === "revenue" ||
      occurrence.criticality === "security" ||
      occurrence.criticality === "core") &&
    (occurrence.uiScope === "page" || occurrence.uiScope === "session" || occurrence.uiScope === "form");

  return {
    capture: true,
    level: alert ? "fatal" : "error",
    breadcrumb: true,
    alert,
    sampleRate: 1,
    fingerprint,
    tags,
  };
};

export const resolveErrorDecision = (input: ErrorDecisionInput): ErrorDecision => {
  const { error, semantics, occurrence } = input;
  const action = resolveAction(error, semantics, occurrence);
  const surface = resolveSurface(error, semantics, occurrence, action);
  const disclosure = resolveDisclosure(semantics, occurrence);
  const supportCode =
    (disclosure === "support-only" || (disclosure === "generic" && semantics.category === "fault")) &&
    input.runtime.correlationId
      ? input.runtime.correlationId
      : undefined;
  const telemetry = resolveTelemetry(error, semantics, occurrence, input.runtime, surface);

  const user: UserErrorDecision = {
    surface,
    disclosure,
    messageKey: resolveMessageKey(semantics, disclosure),
    action,
    target: resolveTarget(semantics, occurrence, surface),
    supportCode,
    retryAfterMs: error.retryAfterMs,
  };

  return { user, telemetry };
};
