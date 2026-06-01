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
  /** Client redirect target for a `redirect` surface (e.g. AUTH_REQUIRED -> "/login"). */
  redirectTarget?: string;
  detailsExposure: "none" | "allowlist";
  detailsAllowlist?: readonly string[];
  /**
   * Type-guard for this code's details. Doubles as the compile-time source of the per-code
   * details shape: `system.fail(code, details)` infers `details` from the guard's predicate.
   */
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

/**
 * Minimal, vendor-neutral input validator. Compatible with zod's `.parse`
 * (which throws on failure). Used by the 3-arg `defineFormAction` overload.
 */
export interface InputSchema<Output> {
  parse(input: unknown): Output;
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
  readonly occurrence?: Partial<OccurrenceContext>;

  constructor(
    code: C,
    details: unknown = null,
    options: {
      message?: string;
      cause?: unknown;
      retryAfterMs?: number;
      userCanRetry?: boolean;
      occurrence?: Partial<OccurrenceContext>;
    } = {},
  ) {
    super(options.message ?? code);
    this.name = "DomainError";
    this.code = code;
    this.details = details;
    this.cause = options.cause;
    this.retryAfterMs = options.retryAfterMs;
    this.userCanRetry = options.userCanRetry;
    this.occurrence = options.occurrence;
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
    occurrence: options?.occurrence,
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
type CatalogKey<Catalog> = Extract<keyof Catalog, string>;

/**
 * The details shape declared for an error code, inferred from its `validateDetails` type-guard.
 * Codes without a guard accept `unknown` (loose). This is what makes `system.fail(code, details)`
 * reject the wrong details shape per code at compile time.
 */
export type DetailsOf<Errors, C extends string> = C extends keyof Errors
  ? Errors[C] extends { validateDetails: (details: unknown) => details is infer D }
    ? D
    : unknown
  : unknown;

export interface ErrorDecisionInput {
  error: DomainError;
  semantics: ErrorSemantics;
  occurrence: OccurrenceContext;
  runtime: RuntimeContext;
}

export interface DecisionSystemOptions<
  Errors extends ErrorCatalog = ErrorCatalog,
  Operations extends OperationCatalog = OperationCatalog,
> {
  errors: Errors;
  operations: Operations;
  fallbackErrorCode: CatalogKey<Errors>;
  defaultRuntime?: RuntimeContext["runtime"];
  sampler?: () => number;
  /**
   * Error code used when a 3-arg `defineFormAction` input schema fails to parse.
   * Required if any form action is given a schema.
   */
  validationErrorCode?: CatalogKey<Errors>;
  /**
   * When true (default), `createDecisionSystem` validates at construction time that every
   * error has an explicit `messageKeys` entry for each disclosure level it can resolve to,
   * so a sensitive `defaultMessageKey` can never leak through a `safe-vague`/`generic`/
   * `support-only` decision. Set false to opt out (not recommended for production catalogs).
   */
  validateMessageKeys?: boolean;
}

export interface DecisionSystem<
  Errors extends ErrorCatalog = ErrorCatalog,
  Operations extends OperationCatalog = OperationCatalog,
> {
  errors: Errors;
  operations: Operations;
  /** Catalog-typed `fail`: `details` is constrained to the code's declared details shape. */
  fail<C extends CatalogKey<Errors>>(code: C, details?: DetailsOf<Errors, C>, options?: FailureOptions): FailureDraft<C, DetailsOf<Errors, C>>;
  /** Catalog-typed `appError`: `details` is constrained to the code's declared details shape. */
  appError<C extends CatalogKey<Errors>>(
    code: C,
    details?: DetailsOf<Errors, C>,
    options?: FailureOptions & { cause?: unknown; message?: string },
  ): DomainError<C>;
  defineOperation(name: CatalogKey<Operations>, meta: Omit<OperationMeta<CatalogKey<Operations>>, "operation">): OperationMeta<CatalogKey<Operations>>;
  makeOccurrence(
    operation: CatalogKey<Operations>,
    defaults: BoundaryDefaults,
    overrides?: Partial<OccurrenceContext<CatalogKey<Operations>>>,
  ): OccurrenceContext<CatalogKey<Operations>>;
  resolveErrorDecision(input: ErrorDecisionInput): ErrorDecision;
  toClientErrorPayload(error: DomainError, decision: ErrorDecision): ClientErrorPayload;
  finalizeFailure<C extends CatalogKey<Errors>>(failure: FailureDraft<C>, occurrence: OccurrenceContext<CatalogKey<Operations>>, runtime?: Partial<RuntimeContext>): DecisionFailure<C>;
  finalizeUnknown(error: unknown, occurrence: OccurrenceContext<CatalogKey<Operations>>, runtime?: Partial<RuntimeContext>): DecisionFailure;
  executeTelemetryDecision(
    error: DomainError,
    decision: TelemetryDecision,
    ctx: TelemetryContext,
    sinks: { reporter: ReporterSink; notifier: NotifierSink },
  ): void;
  /**
   * Runs the telemetry side of a resolved decision and returns the user side for the caller
   * to present. The single entry point a sink/boundary uses so it never re-interprets policy.
   */
  executeErrorDecision(
    error: DomainError,
    decision: ErrorDecision,
    ctx: TelemetryContext,
    sinks: { reporter: ReporterSink; notifier: NotifierSink },
  ): UserErrorDecision;
  defineFormAction<I, O>(
    operation: CatalogKey<Operations>,
    handler: (input: I) => Promise<Success<O> | FailureDraft<CatalogKey<Errors>>> | Success<O> | FailureDraft<CatalogKey<Errors>>,
  ): (input: I) => Promise<DecisionResult<O>>;
  defineFormAction<I, O>(
    operation: CatalogKey<Operations>,
    schema: InputSchema<I>,
    handler: (input: I) => Promise<Success<O> | FailureDraft<CatalogKey<Errors>>> | Success<O> | FailureDraft<CatalogKey<Errors>>,
  ): (input: unknown) => Promise<DecisionResult<O>>;
  defineServerAction<I, O>(
    operation: CatalogKey<Operations>,
    handler: (input: I) => Promise<Success<O> | FailureDraft<CatalogKey<Errors>>> | Success<O> | FailureDraft<CatalogKey<Errors>>,
  ): (input: I) => Promise<DecisionResult<O>>;
  defineQuery<I, O>(operation: CatalogKey<Operations>, handler: (input: I) => Promise<O>): (input: I) => Promise<DecisionResult<O>>;
  defineBackgroundTask(operation: CatalogKey<Operations>, handler: () => Promise<void> | void): () => Promise<DecisionResult<void>>;
  defineRouteGuard<O>(operation: CatalogKey<Operations>, handler: () => Promise<O> | O): () => Promise<DecisionResult<O>>;
  protectedPage<O>(operation: CatalogKey<Operations>, handler: () => Promise<O>): () => Promise<DecisionResult<O>>;
  withRenderBoundary<O>(operation: CatalogKey<Operations>, handler: () => Promise<O> | O): () => Promise<DecisionResult<O>>;
}

export interface BoundaryDefaults {
  interaction: InteractionKind;
  uiScope?: UiScope;
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

// Disclosure levels an error can resolve to from its semantics alone (occurrence overrides
// add more, but these are the unconditional minimum). "specific" is the most-open level and
// never needs a dedicated safe-copy key, so it is excluded from the required set.
const baselineDisclosureLevels = (semantics: ErrorSemantics): DisclosureLevel[] => {
  if (semantics.category === "fault") return ["generic", "support-only"];
  switch (semantics.sensitivity) {
    case "public":
      return [];
    case "auth":
    case "permission":
    case "business-sensitive":
      return ["safe-vague"];
    case "pii":
      return ["safe-vague", "support-only"];
    case "internal":
      return ["generic"];
  }
};

// Every disclosure level this error can actually produce: semantics baseline plus any
// uiScope/resource overrides declared on the registry entry.
const reachableDisclosureLevels = (semantics: ErrorSemantics): DisclosureLevel[] => {
  const levels = new Set<DisclosureLevel>(baselineDisclosureLevels(semantics));
  for (const level of Object.values(semantics.disclosureByUiScope ?? {})) {
    if (level) levels.add(level);
  }
  for (const level of Object.values(semantics.disclosureByResource ?? {})) {
    if (level) levels.add(level);
  }
  levels.delete("specific");
  return [...levels];
};

// Init-time guard: a sensitive disclosure level must select copy from `messageKeys`, never
// fall through to a possibly-sensitive `defaultMessageKey`. Throws so a misconfigured catalog
// fails loudly at construction instead of leaking at runtime.
const validateCatalog = (errors: ErrorCatalog, fallbackErrorCode: string): void => {
  if (!errors[fallbackErrorCode]) {
    throw new Error(`[error-decision-system] fallbackErrorCode "${fallbackErrorCode}" is not present in the error catalog.`);
  }
  const problems: string[] = [];
  for (const [code, semantics] of Object.entries(errors)) {
    for (const level of reachableDisclosureLevels(semantics)) {
      if (!semantics.messageKeys?.[level]) {
        problems.push(`  - "${code}" can resolve to disclosure "${level}" but has no messageKeys["${level}"]`);
      }
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `[error-decision-system] disclosure/messageKey invariant failed. Each error must define a safe messageKey for every disclosure level it can reach:\n${problems.join("\n")}`,
    );
  }
};

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
  error: DomainError,
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

const resolveAction = (_error: DomainError, semantics: ErrorSemantics, occurrence: OccurrenceContext): UserAction => {
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

export const createDecisionSystem = <
  const Errors extends ErrorCatalog,
  const Operations extends OperationCatalog,
>(
  options: DecisionSystemOptions<Errors, Operations>,
): DecisionSystem<Errors, Operations> => {
  const errors = { ...options.errors } as Errors;
  const operations = { ...options.operations } as Operations;
  const defaultRuntime = options.defaultRuntime ?? "client";
  const sampler = options.sampler ?? Math.random;

  if (options.validateMessageKeys !== false) {
    validateCatalog(errors, options.fallbackErrorCode);
  }

  const lookupSemantics = (code: string): ErrorSemantics =>
    errors[code] ?? errors[options.fallbackErrorCode] ?? defaultSemantics(code);

  const defineOperation = (
    name: CatalogKey<Operations>,
    meta: Omit<OperationMeta<CatalogKey<Operations>>, "operation">,
  ): OperationMeta<CatalogKey<Operations>> => {
    const operation = { operation: name, ...meta } as OperationMeta<CatalogKey<Operations>>;
    (operations as OperationCatalog)[name] = operation;
    return operation;
  };

  const getOperation = (operation: CatalogKey<Operations>): OperationMeta => {
    const meta = operations[operation];
    if (!meta) {
      throw new Error(`Unknown operation: ${operation}`);
    }
    return meta;
  };

  const makeOccurrence = (
    operation: CatalogKey<Operations>,
    defaults: BoundaryDefaults,
    overrides: Partial<OccurrenceContext<CatalogKey<Operations>>> = {},
  ): OccurrenceContext<CatalogKey<Operations>> => {
    const operationMeta = getOperation(operation);
    return {
      operation,
      interaction: defaults.interaction,
      uiScope: defaults.uiScope ?? operationMeta.defaultUiScope,
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
        messageKey: resolveMessageKey(input.semantics, disclosure),
        action,
        target: resolveTarget(input.semantics, input.occurrence, surface),
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
    const mergedOccurrence = { ...occurrence, ...error.occurrence };
    const semantics = lookupSemantics(error.code);
    const detailsAreValid = semantics.validateDetails ? semantics.validateDetails(error.details) : true;
    const safeError = detailsAreValid
      ? error
      : (appError(options.fallbackErrorCode, null, { cause: error }) as unknown as DomainError<C>);
    const safeSemantics = detailsAreValid ? semantics : lookupSemantics(safeError.code);
    const decision = resolveErrorDecision({
      error: safeError,
      semantics: safeSemantics,
      occurrence: mergedOccurrence,
      runtime: resolvedRuntime,
    });
    return {
      ok: false,
      error: safeError,
      decision,
      payload: toClientErrorPayload(safeError, decision),
      occurrence: mergedOccurrence,
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
    // `mergedOccurrence` already folded in `failure.options.occurrence` (and applied the
    // fieldPath -> uiScope:"field" rule last). Strip occurrence from the error so
    // finalizeDomainError's `{ ...occurrence, ...error.occurrence }` re-merge cannot clobber it.
    const error = appError(failure.code, failure.details, { ...failure.options, occurrence: undefined });
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

  // unknown -> a client-safe field-error shape. Reads zod-style `.flatten()` when present so a
  // schema's structured fieldErrors survive; otherwise degrades to a single formErrors string.
  // (formErrors stays out of every demo allowlist so raw parser text is never serialized.)
  const toFieldErrors = (err: unknown): { fieldErrors: Record<string, unknown>; formErrors: string[] } => {
    if (
      typeof err === "object" &&
      err !== null &&
      "flatten" in err &&
      typeof (err as { flatten?: unknown }).flatten === "function"
    ) {
      const flat = (err as { flatten: () => { fieldErrors?: Record<string, unknown>; formErrors?: string[] } }).flatten();
      return { fieldErrors: flat.fieldErrors ?? {}, formErrors: flat.formErrors ?? [] };
    }
    return { fieldErrors: {}, formErrors: [err instanceof Error ? err.message : String(err)] };
  };

  const runFormAction = (
    operation: CatalogKey<Operations>,
    schema: InputSchema<unknown> | undefined,
    handler: (input: unknown) => unknown,
  ) => async (input: unknown): Promise<DecisionResult<unknown>> => {
    const occurrence = makeOccurrence(operation, { interaction: "form-submit", uiScope: "form" });
    let parsed = input;
    if (schema) {
      try {
        parsed = schema.parse(input);
      } catch (error) {
        if (options.validationErrorCode) {
          return finalizeFailure(
            fail(options.validationErrorCode, toFieldErrors(error)),
            occurrence,
            { runtime: "server" },
          );
        }
        return finalizeUnknown(error, occurrence, { runtime: "server" });
      }
    }
    try {
      const result = await handler(parsed);
      if (isFailureDraft(result)) return finalizeFailure(result, occurrence);
      return result as DecisionResult<unknown>;
    } catch (error) {
      return finalizeUnknown(error, occurrence, { runtime: "server" });
    }
  };

  const defineFormAction = ((
    operation: CatalogKey<Operations>,
    schemaOrHandler: InputSchema<unknown> | ((input: unknown) => unknown),
    maybeHandler?: (input: unknown) => unknown,
  ) => {
    const hasSchema = typeof maybeHandler === "function";
    const schema = hasSchema ? (schemaOrHandler as InputSchema<unknown>) : undefined;
    const handler = hasSchema ? maybeHandler! : (schemaOrHandler as (input: unknown) => unknown);
    return runFormAction(operation, schema, handler);
  }) as DecisionSystem<Errors, Operations>["defineFormAction"];

  const defineServerAction: DecisionSystem<Errors, Operations>["defineServerAction"] = (operation, handler) => async (input) => {
    const occurrence = makeOccurrence(operation, { interaction: "mutation", uiScope: "component" });
    try {
      const result = await handler(input);
      if (isFailureDraft(result)) return finalizeFailure(result, occurrence, { runtime: "server" });
      return result;
    } catch (error) {
      return finalizeUnknown(error, occurrence, { runtime: "server" });
    }
  };

  const defineQuery: DecisionSystem<Errors, Operations>["defineQuery"] = (operation, handler) => async (input) => {
    const occurrence = makeOccurrence(operation, { interaction: "query", uiScope: "component" });
    try {
      return ok(await handler(input));
    } catch (error) {
      return finalizeUnknown(error, occurrence);
    }
  };

  const defineRouteGuard: DecisionSystem<Errors, Operations>["defineRouteGuard"] = (operation, handler) => async () => {
    const occurrence = makeOccurrence(operation, { interaction: "route-guard", uiScope: "page" });
    try {
      return ok(await handler());
    } catch (error) {
      return finalizeUnknown(error, occurrence, { runtime: "server" });
    }
  };

  const withRenderBoundary: DecisionSystem<Errors, Operations>["withRenderBoundary"] = (operation, handler) => async () => {
    const occurrence = makeOccurrence(operation, { interaction: "render", uiScope: "page", criticality: "core" });
    try {
      return ok(await handler());
    } catch (error) {
      return finalizeUnknown(error, occurrence, { runtime: defaultRuntime });
    }
  };

  const defineBackgroundTask: DecisionSystem<Errors, Operations>["defineBackgroundTask"] = (operation, handler) => async () => {
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

  const protectedPage: DecisionSystem<Errors, Operations>["protectedPage"] = (operation, handler) => async () => {
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

  const executeTelemetryDecision: DecisionSystem<Errors, Operations>["executeTelemetryDecision"] = (error, decision, ctx, sinks) => {
    const sampleRate = decision.sampleRate ?? 1;
    const sampledIn = sampleRate >= 1 || sampler() < sampleRate;
    if (decision.capture && sampledIn) sinks.reporter.capture(error, decision, ctx);
    if (decision.breadcrumb) sinks.reporter.breadcrumb(error, decision, ctx);
    if (decision.alert) sinks.notifier.alert(error, decision, ctx);
  };

  const executeErrorDecision: DecisionSystem<Errors, Operations>["executeErrorDecision"] = (error, decision, ctx, sinks) => {
    executeTelemetryDecision(error, decision.telemetry, ctx, sinks);
    return decision.user;
  };

  // Catalog-typed surface over the free helpers — the per-code details constraint lives entirely
  // in the interface signature (DetailsOf), so the runtime is identical to the loose versions.
  const typedFail = fail as DecisionSystem<Errors, Operations>["fail"];
  const typedAppError = appError as DecisionSystem<Errors, Operations>["appError"];

  return {
    errors,
    operations,
    fail: typedFail,
    appError: typedAppError,
    defineOperation,
    makeOccurrence,
    resolveErrorDecision,
    toClientErrorPayload,
    finalizeFailure,
    finalizeUnknown,
    executeTelemetryDecision,
    executeErrorDecision,
    defineFormAction,
    defineServerAction,
    defineQuery,
    defineBackgroundTask,
    defineRouteGuard,
    protectedPage,
    withRenderBoundary,
  };
};
