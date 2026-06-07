// error-core/decision/system.ts — createDecisionSystem 팩토리 코어. EDS index.ts(createDecisionSystem
// 615-931)에서 포팅하되, inlined resolve*/resolveErrorDecision/validateCatalog/baselineDisclosureLevels/
// reachableDisclosureLevels/defaultSemantics 중복은 삭제하고 ../decision/{resolve,validate}를 import해 호출한다.
// DomainError→AppError(./app-error), isDomainError→isAppError, finalizeDomainError→finalizeAppError.
// 경계 wrapper(defineFormAction/defineServerAction/defineQuery/defineBackgroundTask/defineRouteGuard/
// protectedPage/withRenderBoundary/runFormAction/toFieldErrors/InputSchema)는 P5로 보류 — 여기선 미포팅.
import type {
  ErrorCatalog,
  OperationCatalog,
  ErrorSemantics,
  OperationMeta,
  OccurrenceContext,
  RuntimeContext,
  ErrorDecision,
  UserErrorDecision,
  TelemetryDecision,
  TelemetryContext,
  ClientErrorPayload,
  ReporterSink,
  NotifierSink,
  InteractionKind,
  UiScope,
  Criticality,
} from "./types";
import { AppError, appError, isAppError } from "./app-error";
import { resolveErrorDecision, type ErrorDecisionInput } from "./resolve";
import { validateCatalog } from "./validate";

type CatalogKey<Catalog> = Extract<keyof Catalog, string>;

export interface FailureOptions {
  fieldPath?: string;
  retryAfterMs?: number;
  userCanRetry?: boolean;
  occurrence?: Partial<OccurrenceContext>;
  /**
   * 5% telemetry escape hatch. tags/fingerprint를 override할 땐 PII 금지(불투명 식별자·고정
   * 어휘만) — 커널 기본 산출은 고정 어휘이지만 override 값은 sink 마지막 방어선
   * (sentryBeforeSend 스크럽)까지 그대로 흐른다. PR 리뷰 대상 (RFC §8-5).
   */
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
  error: AppError<C>;
  decision: ErrorDecision;
  payload: ClientErrorPayload;
  occurrence: OccurrenceContext;
}

export type DecisionResult<T, C extends string = string> = Success<T> | DecisionFailure<C>;

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

export const ok = <T>(data: T): Success<T> => ({ ok: true, data });

export const fail = <C extends string, D = null>(
  code: C,
  details: D = null as D,
  options?: FailureOptions,
): FailureDraft<C, D> => ({ ok: false, code, details, options });

export const isFailureDraft = (value: unknown): value is FailureDraft =>
  typeof value === "object" &&
  value !== null &&
  (value as { ok?: unknown }).ok === false &&
  typeof (value as { code?: unknown }).code === "string";

// re-export the unified pure-data error helpers so callers can pull everything from `decision/system`.
export { appError };

export interface BoundaryDefaults {
  interaction: InteractionKind;
  uiScope?: UiScope;
  criticality?: Criticality;
}

// `defaultSemantics`/`validateCatalog`/`resolveErrorDecision`/`resolve*` are intentionally NOT
// inlined here: they are owned by ../decision/{resolve,validate}. Only the unknown-code fallback
// shape lives locally (it mirrors EDS's `defaultSemantics`).
const defaultSemantics = (code: string): ErrorSemantics => ({
  code,
  category: "fault",
  sensitivity: "internal",
  defaultHttpStatus: 500,
  defaultRetryable: false,
  defaultMessageKey: "error.unknown",
  detailsExposure: "none",
});

// SEC-4 / D7: shallow pick. Does NOT recurse, so nested `fieldErrors` (Record<string,string[]>)
// survives intact while sibling non-allowlisted keys are dropped.
// export: sentry-reporter의 details 게이트가 동일 구현을 공유한다(클라 DTO와 같은 allowlist 보장).
export const pickAllowlistedDetails = (details: unknown, allowlist: readonly string[] | undefined): unknown => {
  if (!allowlist?.length || typeof details !== "object" || details === null) return undefined;
  const source = details as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const key of allowlist) {
    if (Object.prototype.hasOwnProperty.call(source, key)) picked[key] = source[key];
  }
  return Object.keys(picked).length > 0 ? picked : undefined;
};

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
   * Error code used when an input validation short-circuits to a failure (consumed by the P5
   * boundary wrappers). Kept on the options surface so the catalog shape stays stable.
   */
  validationErrorCode?: CatalogKey<Errors>;
  /**
   * When true (default), `createDecisionSystem` validates at construction time that every error
   * has an explicit `messageKeys` entry for each disclosure level it can resolve to, so a sensitive
   * `defaultMessageKey` can never leak through a `safe-vague`/`generic`/`support-only` decision.
   */
  validateMessageKeys?: boolean;
  /**
   * Promoter for non-AppError catch values: maps a raw caught value to a KNOWN AppError, or null
   * when no specific shape applies. `finalizeUnknown` tries it FIRST; on null it falls back to this
   * system's own `fallbackErrorCode` (so the P2 server/client UNKNOWN split is never collapsed).
   *
   * LAYERING: `decision/` is catalog-generic and must NOT know CANONICAL codes — so the promoter is
   * INJECTED, never hardcoded here. The host (error-next) wires `tryNormalizeKnownError`.
   *
   * SAFE BY CONSTRUCTION: a promoted AppError still flows through the same `finalizeAppError`, so
   * the codeKnown / validateDetails (D1) gate degrades any out-of-catalog promotion to this
   * system's safe fallback fault — a promoter returning an unknown code can never leak it to wire.
   */
  normalizeUnknown?: (input: unknown) => AppError | null;
}

export interface DecisionSystem<
  Errors extends ErrorCatalog = ErrorCatalog,
  Operations extends OperationCatalog = OperationCatalog,
> {
  errors: Errors;
  operations: Operations;
  /** Catalog-typed `fail`: `details` is constrained to the code's declared details shape. */
  fail<C extends CatalogKey<Errors>>(
    code: C,
    details?: DetailsOf<Errors, C>,
    options?: FailureOptions,
  ): FailureDraft<C, DetailsOf<Errors, C>>;
  /** Catalog-typed `appError`: `details` is constrained to the code's declared details shape. */
  appError<C extends CatalogKey<Errors>>(
    code: C,
    details?: DetailsOf<Errors, C>,
    options?: FailureOptions & { cause?: unknown; message?: string },
  ): AppError<C>;
  defineOperation(
    name: CatalogKey<Operations>,
    meta: Omit<OperationMeta<CatalogKey<Operations>>, "operation">,
  ): OperationMeta<CatalogKey<Operations>>;
  makeOccurrence(
    operation: CatalogKey<Operations>,
    defaults: BoundaryDefaults,
    overrides?: Partial<OccurrenceContext<CatalogKey<Operations>>>,
  ): OccurrenceContext<CatalogKey<Operations>>;
  resolveErrorDecision(input: ErrorDecisionInput): ErrorDecision;
  toClientErrorPayload(error: AppError, decision: ErrorDecision): ClientErrorPayload;
  finalizeFailure<C extends CatalogKey<Errors>>(
    failure: FailureDraft<C>,
    occurrence: OccurrenceContext<CatalogKey<Operations>>,
    runtime?: Partial<RuntimeContext>,
  ): DecisionFailure<C>;
  finalizeUnknown(
    error: unknown,
    occurrence: OccurrenceContext<CatalogKey<Operations>>,
    runtime?: Partial<RuntimeContext>,
  ): DecisionFailure;
  executeTelemetryDecision(
    error: AppError,
    decision: TelemetryDecision,
    ctx: TelemetryContext,
    sinks: { reporter: ReporterSink; notifier: NotifierSink },
  ): void;
  /**
   * Runs the telemetry side of a resolved decision and returns the user side for the caller to
   * present. The single entry point a sink/boundary uses so it never re-interprets policy.
   */
  executeErrorDecision(
    error: AppError,
    decision: ErrorDecision,
    ctx: TelemetryContext,
    sinks: { reporter: ReporterSink; notifier: NotifierSink },
  ): UserErrorDecision;
}

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

  // The degrade point: thread correlationId/digest off the AppError, run the SINGLE allowlist
  // gated by detailsExposure==='allowlist' (shallow per D7), and never copy surface/target.
  //
  // CONTRACT: finalize-후 전용. 이 함수 자체는 codeKnown/validateDetails 강등을 하지 않는다 —
  // 그 게이트는 finalizeAppError가 소유하며, wire로 가는 모든 경로는 finalizeFailure/finalizeUnknown을
  // 거쳐야 한다. 카탈로그 밖 raw AppError를 직접 건네면 그 code 문자열이 payload에 실린다.
  const toClientErrorPayload = (error: AppError, decision: ErrorDecision): ClientErrorPayload => {
    const semantics = lookupSemantics(error.code);
    const details =
      semantics.detailsExposure === "allowlist"
        ? pickAllowlistedDetails(error.details, semantics.detailsAllowlist)
        : undefined;
    return {
      code: error.code,
      messageKey: decision.user.messageKey,
      ...(decision.user.messageVars !== undefined ? { messageVars: decision.user.messageVars } : {}),
      disclosure: decision.user.disclosure,
      action: decision.user.action,
      ...(decision.user.supportCode !== undefined ? { supportCode: decision.user.supportCode } : {}),
      ...(decision.user.retryAfterMs !== undefined ? { retryAfterMs: decision.user.retryAfterMs } : {}),
      ...(error.correlationId !== undefined ? { correlationId: error.correlationId } : {}),
      ...(error.digest !== undefined ? { digest: error.digest } : {}),
      ...(details !== undefined ? { details } : {}),
    };
  };

  const finalizeAppError = <C extends string>(
    error: AppError<C>,
    occurrence: OccurrenceContext,
    runtime: Partial<RuntimeContext> = {},
  ): DecisionFailure<C> => {
    const resolvedRuntime: RuntimeContext = {
      runtime: defaultRuntime,
      ...(error.correlationId !== undefined ? { correlationId: error.correlationId } : {}),
      ...runtime, // explicit runtime arg wins over the error's correlationId
    };
    const mergedOccurrence = { ...occurrence, ...error.occurrence };
    const semantics = lookupSemantics(error.code);
    // D1: per-code details validity gated here at finalize time via `semantics.validateDetails`
    // (NOT zod). Invalid details degrade to the safe fallback fault so a bad payload never reaches
    // the client allowlist or the resolved decision.
    // P2(리뷰): 카탈로그 밖 code도 동일하게 강등한다 — lookupSemantics는 정책만 fallback으로
    // 풀고 error는 원본을 유지했어서, 내부/구버전 code 문자열이 payload.code로 wire에 노출되고
    // 클라 isClientErrorPayload(known-code 가드) 재수화가 실패했다.
    const codeKnown = Object.prototype.hasOwnProperty.call(errors, error.code);
    const detailsAreValid = semantics.validateDetails ? semantics.validateDetails(error.details) : true;
    const isSafe = codeKnown && detailsAreValid;
    const safeError = isSafe
      ? error
      : (appError(options.fallbackErrorCode, null, { cause: error, correlationId: error.correlationId, digest: error.digest }) as unknown as AppError<C>);
    const safeSemantics = isSafe ? semantics : lookupSemantics(safeError.code);
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
    // finalizeAppError's `{ ...occurrence, ...error.occurrence }` re-merge cannot clobber it.
    const error = appError(failure.code, failure.details, { ...failure.options, occurrence: undefined });
    const finalized = finalizeAppError(error, mergedOccurrence, runtime);
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
    if (isAppError(input)) return finalizeAppError(input, occurrence, runtime);
    // Try the injected promoter first so raw framework/network errors (AbortError →
    // REQUEST_ABORTED, fetch TypeError → NETWORK_ERROR/OFFLINE, TimeoutError → TIMEOUT) get a
    // dedicated retryable/operational code instead of being flattened to the fallback fault.
    // A promoted AppError still passes through finalizeAppError, whose codeKnown/validateDetails
    // (D1) gate safely degrades any out-of-catalog promotion to this system's fallbackErrorCode.
    // On null (plain Error, string, etc.) we fall back to THIS system's fallbackErrorCode so the
    // P2 server(UNKNOWN_SERVER_ERROR)/client(UNKNOWN_CLIENT_ERROR) split is preserved — the
    // promoter must never carry its own UNKNOWN_* fallback (that would collapse the split).
    //
    // R2: 주입 promoter 호출을 try/catch로 감싼다 — 에러 처리는 에러 소스가 되면 안 된다(injected
    // 코드라 throw할 수 있다). promoter가 throw하면 null로 취급해 아래 fallback 래핑으로 강등한다.
    let promoted: AppError | null = null;
    try {
      promoted = options.normalizeUnknown?.(input) ?? null;
    } catch {
      promoted = null;
    }
    if (promoted) return finalizeAppError(promoted, occurrence, runtime);
    return finalizeAppError(appError(options.fallbackErrorCode, null, { cause: input }), occurrence, runtime);
  };

  const executeTelemetryDecision: DecisionSystem<Errors, Operations>["executeTelemetryDecision"] = (
    error,
    decision,
    ctx,
    sinks,
  ) => {
    const sampleRate = decision.sampleRate ?? 1;
    const sampledIn = sampleRate >= 1 || sampler() < sampleRate;
    if (decision.capture && sampledIn) sinks.reporter.capture(error, decision, ctx);
    if (decision.breadcrumb) sinks.reporter.breadcrumb(error, decision, ctx);
    if (decision.alert) sinks.notifier.alert(error, decision, ctx);
  };

  const executeErrorDecision: DecisionSystem<Errors, Operations>["executeErrorDecision"] = (
    error,
    decision,
    ctx,
    sinks,
  ) => {
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
  };
};
