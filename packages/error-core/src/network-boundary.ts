// error/network-boundary.ts  — the Network 경계 (변환: raw transport → AppError). THROWING.
import { z } from "zod";
import {
  DomainError,
  construct,
  isClientSerializedError,
  isSerializedError,
  type SerializedError,
} from "./app-error";
import { parseRetryAfter } from "./retry-after";

// P3b-ii: network-boundary stays on the OLD DomainError stack (its withCorrelation/
// fromSerialized/isSerializedError path is registry-based) until P3c. Use the old
// `construct` so produced errors are DomainError, unaffected by makeError → AppError.
const makeError = (opts: {
  code: Parameters<typeof construct>[0];
  details?: unknown;
  cause?: unknown;
}): DomainError => construct(opts.code, opts.details ?? null, { cause: opts.cause });

export interface NetworkBoundaryOptions extends Omit<RequestInit, "signal"> {
  /** Zod schema the JSON body is validated against. Parse failure → SCHEMA_MISMATCH. */
  schema?: z.ZodTypeAny;
  /** Per-call timeout. Defaults to DEFAULT_TIMEOUT_MS. Fires TIMEOUT. */
  timeoutMs?: number;
  /** Caller-owned cancellation (e.g. React Query's queryFn signal). Fires REQUEST_ABORTED. */
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const REQUEST_ID_HEADER = "x-request-id";
const CORRELATION_COOKIE = "x-correlation-id"; // seeded by proxy.ts (non-httpOnly)
const ID_RE = /^[\w-]{8,64}$/;

/** Are we online? Server has no `navigator`; treat absence as "online". */
const isOnline = (): boolean =>
  typeof navigator === "undefined" || navigator.onLine !== false;

/** Lift the server's correlation ID off the response so client errors join the server trace. */
const correlationFrom = (res: Response): string | undefined =>
  res.headers.get(REQUEST_ID_HEADER) ?? undefined;

/**
 * G8: the OUTBOUND page correlationId. On the client we read the non-httpOnly
 * `x-correlation-id` cookie the proxy seeded; the route handler then honors this
 * inbound id (via proxy.ts's well-formed-inbound branch) instead of minting fresh,
 * so the client request and the server trace share one id end-to-end.
 * Returns undefined on the server (no document) — there the bound active value
 * already rides via `await headers()`, and the response-header lift is the fallback.
 */
const outboundCorrelationId = (): string | undefined => {
  if (typeof document === "undefined") return undefined; // server: nothing to read here
  const match = document.cookie.match(/(?:^|;\s*)x-correlation-id=([^;]+)/);
  if (!match || match[1] === undefined) return undefined;
  const value = decodeURIComponent(match[1]);
  return ID_RE.test(value) ? value : undefined;
};

/** Stamp a correlationId onto a freshly-made DomainError. */
const withCorrelation = (err: DomainError, correlationId?: string): DomainError =>
  correlationId && !err.correlationId
    ? DomainError.fromSerialized({ ...err.toSerialized(), correlationId })
    : err;

export async function networkBoundary<T = unknown>(
  url: string | URL,
  opts: NetworkBoundaryOptions = {},
): Promise<T> {
  const { schema, timeoutMs = DEFAULT_TIMEOUT_MS, signal: externalSignal, ...init } = opts;

  // Pre-flight: a known-offline browser never reaches the network — fail fast & specific.
  if (!isOnline()) {
    throw makeError({ code: "OFFLINE", details: null });
  }

  // Compose timeout + caller cancellation. Keep BOTH references so we can discriminate the cause.
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = externalSignal
    ? AbortSignal.any([timeoutSignal, externalSignal])
    : timeoutSignal;

  // G8: stamp the page correlationId outbound so the route handler honors-inbound.
  // A caller-supplied x-request-id (rare) wins; otherwise lift the seeded cookie value.
  const requestHeaders = new Headers(init.headers);
  if (!requestHeaders.has(REQUEST_ID_HEADER)) {
    const outbound = outboundCorrelationId();
    if (outbound) requestHeaders.set(REQUEST_ID_HEADER, outbound);
  }

  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: requestHeaders, signal });
  } catch (cause) {
    // 1. Cancellation/timeout — discriminate by underlying signal state.
    if (timeoutSignal.aborted) {
      throw makeError({ code: "TIMEOUT", details: null, cause });
    }
    if (externalSignal?.aborted) {
      throw makeError({ code: "REQUEST_ABORTED", details: null, cause });
    }
    // 2. The connection may have dropped mid-flight — re-check liveness.
    if (!isOnline()) {
      throw makeError({ code: "OFFLINE", details: null, cause });
    }
    // 3. Any other transport failure (DNS, TLS, CORS, TypeError: Failed to fetch…).
    throw makeError({ code: "NETWORK_ERROR", details: null, cause });
  }

  const correlationId = correlationFrom(res);

  // ── Non-ok: the server-trusted path FIRST, status-class fallback SECOND. ──
  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = undefined;
    }

    // (a) The server spoke our protocol → preserve its chosen code verbatim
    //     (FORBIDDEN / NOT_FOUND / VALIDATION / …). Makes §8.4's inline branch reachable.
    if (isSerializedError(body)) {
      throw DomainError.fromSerialized(body satisfies SerializedError); // already carries correlationId if server set it
    }
    if (isClientSerializedError(body)) {
      throw withCorrelation(DomainError.fromClientSerialized(body), correlationId);
    }

    // (b) Opaque error response → map by status class. 429 carries Retry-After.
    const status = res.status;
    if (status === 429) {
      const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
      throw withCorrelation(
        makeError({
          code: "RATE_LIMITED",
          details: retryAfterMs !== undefined ? { retryAfterMs } : null,
        }),
        correlationId,
      );
    }
    // Narrow `code` to the concrete HTTP literal so makeError infers the matching
    // `{ status: number }` details shape under strict generics (vs the full union).
    const code: "HTTP_SERVER_ERROR" | "HTTP_CLIENT_ERROR" =
      status >= 500 ? "HTTP_SERVER_ERROR" : "HTTP_CLIENT_ERROR";
    throw withCorrelation(makeError({ code, details: { status } }), correlationId);
  }

  // ── Ok: parse the body, validate the shape. ──
  let json: unknown;
  try {
    json = await res.json();
  } catch (cause) {
    throw withCorrelation(
      makeError({ code: "SCHEMA_MISMATCH", details: { endpoint: String(url) }, cause }),
      correlationId,
    );
  }

  if (!schema) {
    return json as T; // No schema supplied → caller asserts the shape (unchecked T cast).
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw withCorrelation(
      makeError({ code: "SCHEMA_MISMATCH", details: { endpoint: String(url) }, cause: parsed.error }),
      correlationId,
    );
  }
  return parsed.data as T;
}
