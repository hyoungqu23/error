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

export interface ErrorSemantics {
  code: string;
  category: ErrorCategory;
  sensitivity: ErrorSensitivity;
  defaultHttpStatus: number;
  defaultRetryable: boolean;
  defaultMessageKey: string;
  detailsExposure: "none" | "allowlist";
  detailsAllowlist?: readonly string[];
  validateDetails?: (details: unknown) => boolean;
}

export interface OperationMeta {
  operation: string;
  owner: string;
  criticality: Criticality;
  defaultUiScope: UiScope;
  piiRisk: boolean;
}

export interface OccurrenceContext {
  operation: string;
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

export interface UserErrorDecision {
  surface: ErrorSurface;
  disclosure: DisclosureLevel;
  messageKey: string;
  action: UserAction;
  target?: string;
  supportCode?: string;
  retryAfterMs?: number;
}

export interface TelemetryDecision {
  capture: boolean;
  level: "info" | "warning" | "error" | "fatal";
  breadcrumb: boolean;
  alert: boolean;
  sampleRate?: number;
  fingerprint?: readonly string[];
  tags?: Record<string, string>;
}

export interface ErrorDecision {
  user: UserErrorDecision;
  telemetry: TelemetryDecision;
}

export interface TelemetryContext extends RuntimeContext {
  operation: string;
}

export interface ReporterSink {
  capture(error: DomainError, decision: TelemetryDecision, ctx: TelemetryContext): void;
  breadcrumb(error: DomainError, decision: TelemetryDecision, ctx: TelemetryContext): void;
}

export interface NotifierSink {
  alert(error: DomainError, decision: TelemetryDecision, ctx: TelemetryContext): void;
}

export interface ClientErrorPayload {
  code: string;
  messageKey: string;
  disclosure: DisclosureLevel;
  action?: UserAction;
  supportCode?: string;
  retryAfterMs?: number;
  details?: unknown;
}

export interface FailureOptions {
  fieldPath?: string;
  retryAfterMs?: number;
  userCanRetry?: boolean;
  occurrence?: Partial<OccurrenceContext>;
  telemetry?: Partial<TelemetryDecision>;
}

export interface Success<T> {
  ok: true;
  data: T;
}

export interface FailureDraft<C extends string = string, D = unknown> {
  ok: false;
  code: C;
  details: D;
  options?: FailureOptions;
}

export interface DecisionFailure<C extends string = string> {
  ok: false;
  error: DomainError<C>;
  decision: ErrorDecision;
  payload: ClientErrorPayload;
  occurrence: OccurrenceContext;
}

export type DecisionResult<T, C extends string = string> = Success<T> | DecisionFailure<C>;

export class DomainError<C extends string = string> extends Error {
  readonly code: C;
  readonly details: unknown;
  override readonly cause?: unknown;
  readonly retryAfterMs?: number;
  readonly userCanRetry?: boolean;

  constructor(
    code: C,
    details: unknown = null,
    options: { message?: string; cause?: unknown; retryAfterMs?: number; userCanRetry?: boolean } = {},
  ) {
    super(options.message ?? code);
    this.name = "DomainError";
    this.code = code;
    this.details = details;
    this.cause = options.cause;
    this.retryAfterMs = options.retryAfterMs;
    this.userCanRetry = options.userCanRetry;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export const ok = <T>(data: T): Success<T> => ({ ok: true, data });

export const fail = <C extends string, D = null>(
  code: C,
  details: D = null as D,
  options?: FailureOptions,
): FailureDraft<C, D> => ({ ok: false, code, details, options });

export const appError = <C extends string>(
  code: C,
  details: unknown = null,
  options?: FailureOptions & { cause?: unknown; message?: string },
): DomainError<C> =>
  new DomainError(code, details, {
    message: options?.message,
    cause: options?.cause,
    retryAfterMs: options?.retryAfterMs,
    userCanRetry: options?.userCanRetry,
  });

export const isDomainError = (value: unknown): value is DomainError =>
  value instanceof DomainError ||
  (typeof value === "object" &&
    value !== null &&
    (value as { name?: unknown }).name === "DomainError" &&
    typeof (value as { code?: unknown }).code === "string");

export const isFailureDraft = (value: unknown): value is FailureDraft =>
  typeof value === "object" &&
  value !== null &&
  (value as { ok?: unknown }).ok === false &&
  typeof (value as { code?: unknown }).code === "string";

export type ErrorCatalog = Record<string, ErrorSemantics>;
export type OperationCatalog = Record<string, OperationMeta>;

export interface ErrorDecisionInput {
  error: DomainError;
  semantics: ErrorSemantics;
  occurrence: OccurrenceContext;
  runtime: RuntimeContext;
}

export interface DecisionSystemOptions {
  errors: ErrorCatalog;
  operations: OperationCatalog;
  fallbackErrorCode: string;
  defaultRuntime?: RuntimeContext["runtime"];
}

export interface DecisionSystem {
  errors: ErrorCatalog;
  operations: OperationCatalog;
  defineOperation(name: string, meta: Omit<OperationMeta, "operation">): OperationMeta;
  makeOccurrence(operation: string, defaults: BoundaryDefaults, overrides?: Partial<OccurrenceContext>): OccurrenceContext;
  resolveErrorDecision(input: ErrorDecisionInput): ErrorDecision;
  toClientErrorPayload(error: DomainError, decision: ErrorDecision): ClientErrorPayload;
  finalizeFailure<C extends string>(failure: FailureDraft<C>, occurrence: OccurrenceContext, runtime?: Partial<RuntimeContext>): DecisionFailure<C>;
  finalizeUnknown(error: unknown, occurrence: OccurrenceContext, runtime?: Partial<RuntimeContext>): DecisionFailure;
  executeTelemetryDecision(
    error: DomainError,
    decision: TelemetryDecision,
    ctx: TelemetryContext,
    sinks: { reporter: ReporterSink; notifier: NotifierSink },
  ): void;
  defineFormAction<I, O>(operation: string, handler: (input: I) => Promise<Success<O> | FailureDraft> | Success<O> | FailureDraft): (input: I) => Promise<DecisionResult<O>>;
  defineQuery<I, O>(operation: string, handler: (input: I) => Promise<O>): (input: I) => Promise<DecisionResult<O>>;
  defineBackgroundTask(operation: string, handler: () => Promise<void> | void): () => Promise<DecisionResult<void>>;
  protectedPage<O>(operation: string, handler: () => Promise<O>): () => Promise<DecisionResult<O>>;
}

export interface BoundaryDefaults {
  interaction: InteractionKind;
  uiScope: UiScope;
  criticality?: Criticality;
}

const defaultSemantics = (code: string): ErrorSemantics => ({
  code,
  category: "fault",
  sensitivity: "internal",
  defaultHttpStatus: 500,
  defaultRetryable: false,
  defaultMessageKey: "error.unknown",
  detailsExposure: "none",
});

const pickAllowlistedDetails = (details: unknown, allowlist: readonly string[] | undefined): unknown => {
  if (!allowlist?.length || typeof details !== "object" || details === null) return undefined;
  const source = details as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const key of allowlist) {
    if (Object.prototype.hasOwnProperty.call(source, key)) picked[key] = source[key];
  }
  return Object.keys(picked).length > 0 ? picked : undefined;
};

const resolveDisclosure = (semantics: ErrorSemantics, occurrence: OccurrenceContext): DisclosureLevel => {
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
  error: DomainError,
  semantics: ErrorSemantics,
  occurrence: OccurrenceContext,
  action: UserAction,
): ErrorSurface => {
  if (occurrence.uiScope === "field" && occurrence.fieldPath) return "field";
  if (occurrence.interaction === "route-guard" && action === "login") return "redirect";
  if (occurrence.interaction === "form-submit") return "form";
  if (occurrence.uiScope === "background" || occurrence.background) return "silent";
  if (occurrence.uiScope === "page" || occurrence.uiScope === "session") return "page";
  if (error.code === "NOT_FOUND" && occurrence.interaction === "query" && occurrence.resource === "collection")
    return "empty";
  if (semantics.category === "operational" && (occurrence.userCanRetry ?? semantics.defaultRetryable)) return "toast";
  return "inline";
};

const resolveAction = (error: DomainError, semantics: ErrorSemantics, occurrence: OccurrenceContext): UserAction => {
  if (error.code === "AUTH_REQUIRED") return "login";
  if (error.code === "FORBIDDEN") return "request-access";
  if (error.code === "RATE_LIMITED") return "wait";
  if (error.code === "NOT_FOUND" && occurrence.uiScope === "page") return "go-back";
  if (error.code === "VALIDATION" || error.code === "INVALID_CREDENTIALS") return "fix-input";
  if (occurrence.userCanRetry ?? error.userCanRetry ?? semantics.defaultRetryable) return "retry";
  if (semantics.category === "fault") return "contact-support";
  return "none";
};

const resolveTelemetry = (
  error: DomainError,
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

  if (error.code === "VALIDATION" && surface === "field") {
    return { capture: false, level: "info", breadcrumb: false, alert: false, fingerprint, tags };
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
      level: important ? "warning" : "warning",
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

export const createDecisionSystem = (options: DecisionSystemOptions): DecisionSystem => {
  const errors: ErrorCatalog = { ...options.errors };
  const operations: OperationCatalog = { ...options.operations };
  const defaultRuntime = options.defaultRuntime ?? "client";

  const lookupSemantics = (code: string): ErrorSemantics =>
    errors[code] ?? errors[options.fallbackErrorCode] ?? defaultSemantics(code);

  const defineOperation = (name: string, meta: Omit<OperationMeta, "operation">): OperationMeta => {
    const operation = { operation: name, ...meta };
    operations[name] = operation;
    return operation;
  };

  const getOperation = (operation: string): OperationMeta => {
    const meta = operations[operation];
    if (!meta) {
      throw new Error(`Unknown operation: ${operation}`);
    }
    return meta;
  };

  const makeOccurrence = (
    operation: string,
    defaults: BoundaryDefaults,
    overrides: Partial<OccurrenceContext> = {},
  ): OccurrenceContext => {
    const operationMeta = getOperation(operation);
    return {
      operation,
      interaction: defaults.interaction,
      uiScope: operationMeta.defaultUiScope ?? defaults.uiScope,
      criticality: defaults.criticality ?? operationMeta.criticality,
      ...overrides,
    };
  };

  const resolveErrorDecision = (input: ErrorDecisionInput): ErrorDecision => {
    const action = resolveAction(input.error, input.semantics, input.occurrence);
    const surface = resolveSurface(input.error, input.semantics, input.occurrence, action);
    const disclosure = resolveDisclosure(input.semantics, input.occurrence);
    const supportCode =
      (disclosure === "support-only" || (disclosure === "generic" && input.semantics.category === "fault")) &&
      input.runtime.correlationId
        ? input.runtime.correlationId
        : undefined;
    const telemetry = resolveTelemetry(input.error, input.semantics, input.occurrence, input.runtime, surface);

    return {
      user: {
        surface,
        disclosure,
        messageKey: input.semantics.defaultMessageKey,
        action,
        target: input.occurrence.fieldPath,
        supportCode,
        retryAfterMs: input.error.retryAfterMs,
      },
      telemetry,
    };
  };

  const toClientErrorPayload = (error: DomainError, decision: ErrorDecision): ClientErrorPayload => {
    const semantics = lookupSemantics(error.code);
    const details =
      semantics.detailsExposure === "allowlist"
        ? pickAllowlistedDetails(error.details, semantics.detailsAllowlist)
        : undefined;
    return {
      code: error.code,
      messageKey: decision.user.messageKey,
      disclosure: decision.user.disclosure,
      action: decision.user.action,
      supportCode: decision.user.supportCode,
      retryAfterMs: decision.user.retryAfterMs,
      ...(details !== undefined ? { details } : {}),
    };
  };

  const finalizeDomainError = <C extends string>(
    error: DomainError<C>,
    occurrence: OccurrenceContext,
    runtime: Partial<RuntimeContext> = {},
  ): DecisionFailure<C> => {
    const resolvedRuntime: RuntimeContext = { runtime: defaultRuntime, ...runtime };
    const semantics = lookupSemantics(error.code);
    const detailsAreValid = semantics.validateDetails ? semantics.validateDetails(error.details) : true;
    const safeError = detailsAreValid
      ? error
      : (appError(options.fallbackErrorCode, null, { cause: error }) as DomainError<C>);
    const safeSemantics = detailsAreValid ? semantics : lookupSemantics(safeError.code);
    const decision = resolveErrorDecision({
      error: safeError,
      semantics: safeSemantics,
      occurrence,
      runtime: resolvedRuntime,
    });
    return {
      ok: false,
      error: safeError,
      decision,
      payload: toClientErrorPayload(safeError, decision),
      occurrence,
    };
  };

  const finalizeFailure = <C extends string>(
    failure: FailureDraft<C>,
    occurrence: OccurrenceContext,
    runtime?: Partial<RuntimeContext>,
  ): DecisionFailure<C> => {
    const mergedOccurrence = { ...occurrence, ...failure.options?.occurrence };
    if (failure.options?.fieldPath) {
      mergedOccurrence.fieldPath = failure.options.fieldPath;
      mergedOccurrence.uiScope = "field";
    }
    if (failure.options?.userCanRetry !== undefined) mergedOccurrence.userCanRetry = failure.options.userCanRetry;
    const error = appError(failure.code, failure.details, failure.options);
    const finalized = finalizeDomainError(error, mergedOccurrence, runtime);
    if (!failure.options?.telemetry) return finalized;
    return {
      ...finalized,
      decision: {
        ...finalized.decision,
        telemetry: { ...finalized.decision.telemetry, ...failure.options.telemetry },
      },
    };
  };

  const finalizeUnknown = (
    input: unknown,
    occurrence: OccurrenceContext,
    runtime?: Partial<RuntimeContext>,
  ): DecisionFailure => {
    if (isDomainError(input)) return finalizeDomainError(input, occurrence, runtime);
    return finalizeDomainError(appError(options.fallbackErrorCode, null, { cause: input }), occurrence, runtime);
  };

  const defineFormAction: DecisionSystem["defineFormAction"] = (operation, handler) => async (input) => {
    const occurrence = makeOccurrence(operation, { interaction: "form-submit", uiScope: "form" });
    try {
      const result = await handler(input);
      if (isFailureDraft(result)) return finalizeFailure(result, occurrence);
      return result;
    } catch (error) {
      return finalizeUnknown(error, occurrence, { runtime: "server" });
    }
  };

  const defineQuery: DecisionSystem["defineQuery"] = (operation, handler) => async (input) => {
    const occurrence = makeOccurrence(operation, { interaction: "query", uiScope: "component" });
    try {
      return ok(await handler(input));
    } catch (error) {
      return finalizeUnknown(error, occurrence);
    }
  };

  const defineBackgroundTask: DecisionSystem["defineBackgroundTask"] = (operation, handler) => async () => {
    const occurrence = makeOccurrence(operation, {
      interaction: "background-sync",
      uiScope: "background",
      criticality: "low",
    });
    try {
      await handler();
      return ok(undefined);
    } catch (error) {
      return finalizeUnknown(error, occurrence);
    }
  };

  const protectedPage: DecisionSystem["protectedPage"] = (operation, handler) => async () => {
    const occurrence = makeOccurrence(operation, {
      interaction: "route-guard",
      uiScope: "page",
      criticality: "security",
    });
    try {
      return ok(await handler());
    } catch (error) {
      return finalizeUnknown(error, occurrence, { runtime: "server" });
    }
  };

  const executeTelemetryDecision: DecisionSystem["executeTelemetryDecision"] = (error, decision, ctx, sinks) => {
    if (decision.capture) sinks.reporter.capture(error, decision, ctx);
    if (decision.breadcrumb) sinks.reporter.breadcrumb(error, decision, ctx);
    if (decision.alert) sinks.notifier.alert(error, decision, ctx);
  };

  return {
    errors,
    operations,
    defineOperation,
    makeOccurrence,
    resolveErrorDecision,
    toClientErrorPayload,
    finalizeFailure,
    finalizeUnknown,
    executeTelemetryDecision,
    defineFormAction,
    defineQuery,
    defineBackgroundTask,
    protectedPage,
  };
};
