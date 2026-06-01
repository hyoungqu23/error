// ============================================================================
// error/app-error.ts  — getters read the ACTIVE registry; resolvePolicy shared.
// Class carries `digest`; toSerialized() emits it; fromSerialized + construct().
// ============================================================================
import type { ErrorCode, ErrorMeta, ErrorRegistry } from "./registry";
import { DEFAULT_ERROR_REGISTRY } from "./registry";
import { getActiveErrorRegistry } from "./active-registry";
import { ErrorDetailsSchema, type ErrorDetailsMap } from "./schema";
import { getRuntime } from "./runtime";
import type { Severity } from "./severity";
import type { ErrorKind, PresentAction, LogLevel, HttpStatus } from "./policy";

/** Plain DTO that crosses the RSC / network boundary. Never a class instance. */
export interface SerializedError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly details: unknown;
  readonly correlationId?: string;
  readonly digest?: string; // Next.js RSC digest when available
}

/**
 * Client-bound DTO produced by toClientSerialized(). It intentionally has no
 * free-text message; copy is resolved from the registry's userMessageKey.
 */
export interface ClientSerializedError {
  readonly code: ErrorCode;
  readonly userMessageKey: string;
  readonly correlationId?: string;
  readonly digest?: string;
  readonly details?: unknown;
}

export interface AppErrorOptions<C extends ErrorCode> {
  code: C;
  details: ErrorDetailsMap[C];
  message?: string;
  cause?: unknown;
  severity?: Severity;
  retryable?: boolean;
  correlationId?: string;
  /** Next.js RSC digest, when this error was rehydrated from a serialized payload. */
  digest?: string;
}

/** All resolved policy fields. The single shape handleError returns. */
export interface ResolvedPolicy {
  readonly expected: boolean;
  readonly isOperational: boolean;
  readonly severity: Severity;
  readonly present: PresentAction;
  readonly log: LogLevel;
  readonly httpStatus: HttpStatus;
  readonly retryable: boolean;
  readonly userMessageKey: string;
}

/**
 * Resolve a code against a given registry into a full policy bundle. The single
 * place all seven fields are computed; per-instance overrides win, exactly as
 * the getters do. Defensive fallback when a substituted registry lacks a code.
 */
export const resolvePolicy = (
  registry: ErrorRegistry,
  code: ErrorCode,
  overrides?: { severity?: Severity; retryable?: boolean },
): ResolvedPolicy => {
  const meta: ErrorMeta = registry[code] ?? DEFAULT_ERROR_REGISTRY.UNKNOWN_CLIENT_ERROR;
  return {
    expected: meta.kind === "business",
    isOperational: meta.kind !== "fault",
    severity: overrides?.severity ?? meta.severity,
    present: meta.present,
    log: meta.log,
    httpStatus: meta.httpStatus,
    retryable: overrides?.retryable ?? meta.retryable,
    userMessageKey: meta.userMessageKey,
  };
};

/** Authoritative result of handleError: normalized error + resolved policy. */
export interface ResolvedAppError<C extends ErrorCode = ErrorCode> {
  readonly error: DomainError<C>;
  readonly code: C;
  readonly policy: ResolvedPolicy;
}

/**
 * Canonical internal error (`AppError` is the documented alias). Getters read
 * the *active* registry — never a bare module global — so the instance and the
 * handleError resolver agree by construction. Created through makeError()/
 * construct()/fromSerialized() so details are validated.
 */
export class DomainError<C extends ErrorCode = ErrorCode> extends Error {
  readonly code: C;
  readonly details: ErrorDetailsMap[C];
  readonly correlationId?: string;
  readonly digest?: string; // stored so it round-trips
  private readonly severityOverride?: Severity;
  private readonly retryableOverride?: boolean;

  constructor(opts: AppErrorOptions<C>) {
    super(opts.message ?? opts.code, { cause: opts.cause });
    this.name = "DomainError";
    this.code = opts.code;
    this.details = opts.details;
    this.correlationId = opts.correlationId;
    this.digest = opts.digest;
    this.severityOverride = opts.severity;
    this.retryableOverride = opts.retryable;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** The ErrorMeta in force for this instance, off the active registry. */
  private get meta(): ErrorMeta {
    const registry = getActiveErrorRegistry();
    return registry[this.code] ?? DEFAULT_ERROR_REGISTRY.UNKNOWN_CLIENT_ERROR;
  }

  get kind(): ErrorKind {
    return this.meta.kind;
  }
  get expected(): boolean {
    return this.kind === "business";
  }
  get isOperational(): boolean {
    return this.kind !== "fault";
  }
  get severity(): Severity {
    return this.severityOverride ?? this.meta.severity;
  }
  get retryable(): boolean {
    return this.retryableOverride ?? this.meta.retryable;
  }
  get httpStatus(): HttpStatus {
    return this.meta.httpStatus;
  }
  get present(): PresentAction {
    return this.meta.present;
  }
  get log(): LogLevel {
    return this.meta.log;
  }
  get userMessageKey(): string {
    return this.meta.userMessageKey;
  }

  /** Resolve the full policy bundle off the active registry (mirrors resolvePolicy). */
  resolve(): ResolvedPolicy {
    return resolvePolicy(getActiveErrorRegistry(), this.code, {
      severity: this.severityOverride,
      retryable: this.retryableOverride,
    });
  }

  toSerialized(): SerializedError {
    // Omit undefined keys so JSON.parse(JSON.stringify(...)) round-trips structurally
    // and deep-equality in tests is exact (no `correlationId: undefined` ghost keys).
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      ...(this.correlationId !== undefined ? { correlationId: this.correlationId } : {}),
      ...(this.digest !== undefined ? { digest: this.digest } : {}),
    };
  }

  /**
   * Rebuild a first-class DomainError from a plain SerializedError that crossed the
   * RSC/network boundary. Re-validates `details` against the per-code schema (the
   * makeError-style path) and preserves code / correlationId / digest. On a miss the
   * payload is corrupt or forged → fall back to the runtime UNKNOWN_* code but STILL
   * carry correlationId + digest so the support trail survives.
   */
  static fromSerialized(s: SerializedError): DomainError {
    const parsed = ErrorDetailsSchema[s.code].safeParse(s.details);
    if (!parsed.success) {
      const fallback: ErrorCode =
        getRuntime() === "server" ? "UNKNOWN_SERVER_ERROR" : "UNKNOWN_CLIENT_ERROR";
      return construct(fallback, null, {
        message: s.message,
        cause: s.details,
        correlationId: s.correlationId,
        digest: s.digest,
      });
    }
    return construct(s.code, parsed.data, {
      message: s.message,
      correlationId: s.correlationId,
      digest: s.digest,
    });
  }

  /**
   * Rebuild from the public, client-safe wire DTO. Missing details are treated as
   * null so nullable/null schemas round-trip while required schemas (VALIDATION)
   * still fail closed when their allowlisted payload is absent or forged.
   */
  static fromClientSerialized(s: ClientSerializedError): DomainError {
    const details = Object.prototype.hasOwnProperty.call(s, "details") ? s.details : null;
    const parsed = ErrorDetailsSchema[s.code].safeParse(details);
    if (!parsed.success) {
      const fallback: ErrorCode =
        getRuntime() === "server" ? "UNKNOWN_SERVER_ERROR" : "UNKNOWN_CLIENT_ERROR";
      return construct(fallback, null, {
        message: fallback,
        cause: details,
        correlationId: s.correlationId,
        digest: s.digest,
      });
    }
    return construct(s.code, parsed.data, {
      message: s.code,
      correlationId: s.correlationId,
      digest: s.digest,
    });
  }
}

/**
 * Internal factory for the two creation paths (makeError, fromSerialized) where the
 * code↔details correlation is established at runtime (Zod parse) but unprovable to the
 * type system: ErrorDetailsMap has no common member, so generic `ErrorDetailsMap[C]`
 * collapses to `never`. The ONE cast lives here; feature code never casts.
 */
export const construct = (
  code: ErrorCode,
  details: unknown,
  rest: Omit<AppErrorOptions<ErrorCode>, "code" | "details"> = {},
): DomainError =>
  new DomainError({ code, details: details as ErrorDetailsMap[ErrorCode], ...rest });

export type AppError<C extends ErrorCode = ErrorCode> = DomainError<C>;

// Type guards (from the series)
export const isDomainError = <C extends ErrorCode>(e: unknown, code?: C): e is DomainError<C> =>
  e instanceof DomainError && (!code || e.code === code);

/** A code is "serialized-valid" iff the ACTIVE registry knows it. */
export const isSerializedError = (e: unknown): e is SerializedError =>
  typeof e === "object" &&
  e !== null &&
  "code" in e &&
  "message" in e &&
  typeof (e as SerializedError).code === "string" &&
  (e as SerializedError).code in getActiveErrorRegistry();

/** Public client-safe DTO guard: code + userMessageKey, but intentionally no message. */
export const isClientSerializedError = (e: unknown): e is ClientSerializedError =>
  typeof e === "object" &&
  e !== null &&
  "code" in e &&
  "userMessageKey" in e &&
  !("message" in e) &&
  typeof (e as ClientSerializedError).code === "string" &&
  typeof (e as ClientSerializedError).userMessageKey === "string" &&
  (e as ClientSerializedError).code in getActiveErrorRegistry();

/**
 * Pure intent lookup off the *active* registry so a substituted catalog governs
 * `expected` consistently with handleError + the getters. Used by
 * safeServerAction's Track-1/Track-2 split (§7.1). Re-exported from registry-free
 * code as `@/error/app-error`.
 */
export const isExpectedCode = (code: ErrorCode): boolean =>
  (getActiveErrorRegistry()[code] ?? DEFAULT_ERROR_REGISTRY.UNKNOWN_CLIENT_ERROR).kind === "business";
