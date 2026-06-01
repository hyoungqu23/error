// §10 networkBoundary — branch coverage.
// Mocks global fetch (vi.stubGlobal) and stubs navigator/online state; asserts each
// transport/HTTP-status branch throws the right DomainError code, that 429 parses
// Retry-After (delta-seconds AND HTTP-date) into details.retryAfterMs, that a server
// SerializedError body is preserved verbatim, that timeout vs caller-abort are
// discriminated, that inbound x-request-id is lifted onto the thrown error's
// correlationId, AND (G8) that the OUTBOUND x-request-id is stamped from the client's
// x-correlation-id cookie so the route handler honors-inbound instead of minting fresh.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { networkBoundary } from "@/error/network-boundary";
import { isDomainError, DomainError } from "@/error/app-error";
import { makeError } from "@/error/make-error";
import { toClientSerialized } from "@/error/serialize-client";
import { z } from "zod";

// ── Helpers ────────────────────────────────────────────────────────────────

/** Build a real Response with a JSON body and chosen status/headers. */
function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  const status = init.status ?? 200;
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

/** A non-JSON / unparseable body Response (so res.json() throws). */
function opaqueResponse(
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  const status = init.status ?? 200;
  return new Response("<<not json>>", {
    status,
    headers: { "content-type": "text/plain", ...(init.headers ?? {}) },
  });
}

/** Stub fetch to resolve with the given Response (ignores signal). */
function stubFetchResolving(res: Response): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((): Promise<Response> => Promise.resolve(res)),
  );
}

/**
 * Stub fetch to reject with an AbortError, but only once the AbortSignal it
 * receives actually aborts. This lets the test drive WHICH signal fires
 * (timeout vs caller) and have networkBoundary's discrimination read the real
 * `.aborted` flags — exactly as production fetch behaves.
 */
function stubFetchAbortingOnSignal(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: unknown, init?: RequestInit): Promise<Response> => {
      const signal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        const fail = (): void => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        };
        if (signal?.aborted) {
          fail();
          return;
        }
        signal?.addEventListener("abort", fail, { once: true });
      });
    }),
  );
}

/** Stub fetch to reject with a generic transport error (TypeError: Failed to fetch). */
function stubFetchRejectingNetwork(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((): Promise<Response> => Promise.reject(new TypeError("Failed to fetch"))),
  );
}

const URL_UNDER_TEST = "https://api.example.test/resource";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── 1. Server-trusted path: SerializedError body preserves the server's code ──

describe("networkBoundary — server SerializedError body", () => {
  beforeEach(() => {
    // navigator absent → treated as online (server runtime). Ensure no stale stub.
    vi.unstubAllGlobals();
  });

  it("preserves the server-chosen code (FORBIDDEN) when the non-ok body isSerializedError", async () => {
    stubFetchResolving(
      jsonResponse(
        { code: "FORBIDDEN", message: "nope", details: { requiredRole: "admin" } },
        { status: 403 },
      ),
    );

    const thrown = await networkBoundary(URL_UNDER_TEST).catch((e: unknown) => e);
    expect(isDomainError(thrown, "FORBIDDEN")).toBe(true);
    const err = thrown as DomainError;
    expect(err.code).toBe("FORBIDDEN");
    expect(err.details).toEqual({ requiredRole: "admin" });
  });

  it("preserves a server correlationId embedded in the serialized body", async () => {
    stubFetchResolving(
      jsonResponse(
        {
          code: "NOT_FOUND",
          message: "gone",
          details: { resource: "user" },
          correlationId: "srv-corr-123",
        },
        { status: 404 },
      ),
    );

    const err = (await networkBoundary(URL_UNDER_TEST).catch((e: unknown) => e)) as DomainError;
    expect(err.code).toBe("NOT_FOUND");
    expect(err.correlationId).toBe("srv-corr-123");
  });

  it("preserves a client-safe Route Handler DTO without a message field", async () => {
    const dto = toClientSerialized(
      makeError({ code: "FORBIDDEN", details: { requiredRole: "admin" } }),
    );
    expect("message" in dto).toBe(false);

    stubFetchResolving(
      jsonResponse(dto, { status: 403, headers: { "x-request-id": "req-forbidden-1" } }),
    );

    const err = (await networkBoundary(URL_UNDER_TEST).catch((e: unknown) => e)) as DomainError;
    expect(err.code).toBe("FORBIDDEN");
    expect(err.details).toBeNull();
    expect(err.correlationId).toBe("req-forbidden-1");
  });

  it("rehydrates allowlisted VALIDATION details from a client-safe Route Handler DTO", async () => {
    const dto = toClientSerialized(
      makeError({
        code: "VALIDATION",
        details: { fieldErrors: { email: ["invalid"] } },
      }),
    );

    stubFetchResolving(jsonResponse(dto, { status: 422 }));

    const err = (await networkBoundary(URL_UNDER_TEST).catch((e: unknown) => e)) as DomainError;
    expect(err.code).toBe("VALIDATION");
    expect(err.details).toEqual({ fieldErrors: { email: ["invalid"] } });
  });
});

// ── 2. 429 RATE_LIMITED — Retry-After parsing (delta-seconds + HTTP-date) ──

describe("networkBoundary — 429 RATE_LIMITED", () => {
  it("parses delta-seconds Retry-After into details.retryAfterMs (×1000)", async () => {
    stubFetchResolving(
      opaqueResponse({ status: 429, headers: { "retry-after": "120" } }),
    );

    const err = (await networkBoundary(URL_UNDER_TEST).catch((e: unknown) => e)) as DomainError;
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.details).toEqual({ retryAfterMs: 120_000 });
  });

  it("parses an HTTP-date Retry-After into a non-negative ms delta from now", async () => {
    // Pin the clock so the HTTP-date delta is deterministic. parseRetryAfter
    // defaults now = Date.now(); fake timers make that fixed.
    const base = new Date("2025-10-21T07:28:00.000Z").getTime();
    vi.useFakeTimers();
    vi.setSystemTime(base);

    // 30s in the future.
    const future = new Date(base + 30_000).toUTCString();
    stubFetchResolving(
      opaqueResponse({ status: 429, headers: { "retry-after": future } }),
    );

    const err = (await networkBoundary(URL_UNDER_TEST).catch((e: unknown) => e)) as DomainError;
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.details).toEqual({ retryAfterMs: 30_000 });
  });

  it("yields RATE_LIMITED with null details when no Retry-After header is present", async () => {
    stubFetchResolving(opaqueResponse({ status: 429 }));

    const err = (await networkBoundary(URL_UNDER_TEST).catch((e: unknown) => e)) as DomainError;
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.details).toBeNull();
  });

  it("lifts x-request-id onto the 429 error's correlationId", async () => {
    stubFetchResolving(
      opaqueResponse({
        status: 429,
        headers: { "retry-after": "5", "x-request-id": "req-429-abc" },
      }),
    );

    const err = (await networkBoundary(URL_UNDER_TEST).catch((e: unknown) => e)) as DomainError;
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.correlationId).toBe("req-429-abc");
    expect(err.details).toEqual({ retryAfterMs: 5_000 });
  });
});

// ── 3. Status-class fallback: generic 4xx / 5xx ──

describe("networkBoundary — HTTP status-class fallback", () => {
  it("maps a generic 4xx (non-serialized body) to HTTP_CLIENT_ERROR with details.status", async () => {
    stubFetchResolving(opaqueResponse({ status: 400 }));

    const err = (await networkBoundary(URL_UNDER_TEST).catch((e: unknown) => e)) as DomainError;
    expect(err.code).toBe("HTTP_CLIENT_ERROR");
    expect(err.details).toEqual({ status: 400 });
  });

  it("maps a 5xx (non-serialized body) to HTTP_SERVER_ERROR with details.status", async () => {
    stubFetchResolving(opaqueResponse({ status: 503 }));

    const err = (await networkBoundary(URL_UNDER_TEST).catch((e: unknown) => e)) as DomainError;
    expect(err.code).toBe("HTTP_SERVER_ERROR");
    expect(err.details).toEqual({ status: 503 });
  });

  it("lifts x-request-id onto a status-class fallback error", async () => {
    stubFetchResolving(
      opaqueResponse({ status: 500, headers: { "x-request-id": "req-500-xyz" } }),
    );

    const err = (await networkBoundary(URL_UNDER_TEST).catch((e: unknown) => e)) as DomainError;
    expect(err.code).toBe("HTTP_SERVER_ERROR");
    expect(err.correlationId).toBe("req-500-xyz");
  });

  it("falls through to status-class when the non-ok body is JSON but NOT a SerializedError", async () => {
    // Body is valid JSON but has no registry-known `code` → not serialized → status class.
    stubFetchResolving(jsonResponse({ message: "boom", oops: true }, { status: 404 }));

    const err = (await networkBoundary(URL_UNDER_TEST).catch((e: unknown) => e)) as DomainError;
    expect(err.code).toBe("HTTP_CLIENT_ERROR");
    expect(err.details).toEqual({ status: 404 });
  });
});

// ── 4. OFFLINE — navigator.onLine === false ──

describe("networkBoundary — OFFLINE", () => {
  it("fails fast with OFFLINE before fetch when navigator.onLine is false", async () => {
    const fetchSpy = vi.fn((): Promise<Response> => Promise.resolve(jsonResponse({})));
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("navigator", { onLine: false });

    const err = (await networkBoundary(URL_UNDER_TEST).catch((e: unknown) => e)) as DomainError;
    expect(err.code).toBe("OFFLINE");
    // Pre-flight: the network was never touched.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("maps a mid-flight transport failure to OFFLINE when navigator goes offline", async () => {
    // Online at pre-flight, then fetch rejects while navigator reports offline.
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal(
      "fetch",
      vi.fn((): Promise<Response> => {
        vi.stubGlobal("navigator", { onLine: false });
        return Promise.reject(new TypeError("Failed to fetch"));
      }),
    );

    const err = (await networkBoundary(URL_UNDER_TEST).catch((e: unknown) => e)) as DomainError;
    expect(err.code).toBe("OFFLINE");
  });
});

// ── 5. SCHEMA_MISMATCH — body fails the supplied zod schema ──

describe("networkBoundary — SCHEMA_MISMATCH", () => {
  it("throws SCHEMA_MISMATCH when the ok body fails the provided schema", async () => {
    stubFetchResolving(jsonResponse({ id: "not-a-number" }, { status: 200 }));
    const schema = z.object({ id: z.number() });

    const err = (await networkBoundary(URL_UNDER_TEST, { schema }).catch(
      (e: unknown) => e,
    )) as DomainError;
    expect(err.code).toBe("SCHEMA_MISMATCH");
    expect(err.details).toEqual({ endpoint: URL_UNDER_TEST });
  });

  it("returns the parsed data (no throw) when the ok body satisfies the schema", async () => {
    stubFetchResolving(jsonResponse({ id: 7, name: "ok" }, { status: 200 }));
    const schema = z.object({ id: z.number(), name: z.string() });

    const data = await networkBoundary(URL_UNDER_TEST, { schema });
    expect(data).toEqual({ id: 7, name: "ok" });
  });

  it("throws SCHEMA_MISMATCH when an ok body is not valid JSON", async () => {
    stubFetchResolving(opaqueResponse({ status: 200 }));

    const err = (await networkBoundary(URL_UNDER_TEST).catch((e: unknown) => e)) as DomainError;
    expect(err.code).toBe("SCHEMA_MISMATCH");
  });

  it("lifts x-request-id onto a SCHEMA_MISMATCH error", async () => {
    stubFetchResolving(
      jsonResponse({ id: "bad" }, { status: 200, headers: { "x-request-id": "req-schema-1" } }),
    );
    const schema = z.object({ id: z.number() });

    const err = (await networkBoundary(URL_UNDER_TEST, { schema }).catch(
      (e: unknown) => e,
    )) as DomainError;
    expect(err.code).toBe("SCHEMA_MISMATCH");
    expect(err.correlationId).toBe("req-schema-1");
  });
});

// ── 6. NETWORK_ERROR — generic transport failure, still online ──

describe("networkBoundary — NETWORK_ERROR", () => {
  it("maps a generic fetch rejection (online, not aborted) to NETWORK_ERROR", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    stubFetchRejectingNetwork();

    const err = (await networkBoundary(URL_UNDER_TEST).catch((e: unknown) => e)) as DomainError;
    expect(err.code).toBe("NETWORK_ERROR");
    // The original transport error is preserved as the cause.
    expect((err.cause as Error)?.name).toBe("TypeError");
  });
});

// ── 7. TIMEOUT vs REQUEST_ABORTED — discriminated by which signal aborted ──

describe("networkBoundary — abort discrimination", () => {
  it("throws TIMEOUT when the internal timeout signal fires", async () => {
    // Real (tiny) timers here: AbortSignal.timeout() uses an internal Node timer
    // that vitest's fake clock does not drive, so we let a 5ms real timeout fire.
    vi.stubGlobal("navigator", { onLine: true });
    stubFetchAbortingOnSignal();

    // timeoutSignal aborts → fetch rejects with AbortError → discriminated as TIMEOUT.
    const err = (await networkBoundary(URL_UNDER_TEST, { timeoutMs: 5 }).catch(
      (e: unknown) => e,
    )) as DomainError;
    expect(err.code).toBe("TIMEOUT");
  });

  it("throws REQUEST_ABORTED when the caller-owned signal aborts (timeout not fired)", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    stubFetchAbortingOnSignal();

    const controller = new AbortController();
    const promise = networkBoundary(URL_UNDER_TEST, {
      timeoutMs: 60_000, // long real timeout — does NOT fire within the test
      signal: controller.signal,
    }).catch((e: unknown) => e);

    // Abort via the caller's controller — timeoutSignal stays un-aborted, so the
    // discriminator must attribute this to the external signal.
    controller.abort();

    const err = (await promise) as DomainError;
    expect(err.code).toBe("REQUEST_ABORTED");
  });
});

// ── 8. G8: OUTBOUND x-request-id — send the page correlationId so the route ──
//        handler honors-inbound instead of minting fresh.

describe("networkBoundary — G8 outbound x-request-id (correlation propagation)", () => {
  /** Capture the headers networkBoundary hands to fetch on its single call. */
  function stubFetchCapturing(res: Response): { calls: Headers[] } {
    const calls: Headers[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: unknown, init?: RequestInit): Promise<Response> => {
        // network-boundary always passes a Headers instance as init.headers.
        calls.push(new Headers(init?.headers));
        return Promise.resolve(res);
      }),
    );
    return { calls };
  }

  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("sets x-request-id outbound from the client's x-correlation-id cookie", async () => {
    // Simulate the client runtime: `document.cookie` carries the proxy-seeded id.
    vi.stubGlobal("document", { cookie: "foo=bar; x-correlation-id=corr-out-123; other=1" });
    vi.stubGlobal("navigator", { onLine: true });
    const { calls } = stubFetchCapturing(jsonResponse({ ok: true }, { status: 200 }));

    await networkBoundary(URL_UNDER_TEST);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.get("x-request-id")).toBe("corr-out-123");
  });

  it("URL-decodes the cookie value before stamping it outbound", async () => {
    // The cookie is percent-encoded by the seeder; the outbound id is the decoded form.
    const raw = "corr-with-encoded";
    vi.stubGlobal("document", {
      cookie: `x-correlation-id=${encodeURIComponent(raw)}`,
    });
    vi.stubGlobal("navigator", { onLine: true });
    const { calls } = stubFetchCapturing(jsonResponse({ ok: true }, { status: 200 }));

    await networkBoundary(URL_UNDER_TEST);
    expect(calls[0]!.get("x-request-id")).toBe(raw);
  });

  it("a caller-supplied x-request-id WINS over the cookie value", async () => {
    vi.stubGlobal("document", { cookie: "x-correlation-id=cookie-id-999" });
    vi.stubGlobal("navigator", { onLine: true });
    const { calls } = stubFetchCapturing(jsonResponse({ ok: true }, { status: 200 }));

    await networkBoundary(URL_UNDER_TEST, { headers: { "x-request-id": "caller-wins-id" } });
    expect(calls[0]!.get("x-request-id")).toBe("caller-wins-id");
  });

  it("does NOT stamp x-request-id when the cookie value is malformed (fails ID_RE)", async () => {
    // The guard only forwards a well-formed id (^[\w-]{8,64}$); "short" is too short.
    vi.stubGlobal("document", { cookie: "x-correlation-id=short" });
    vi.stubGlobal("navigator", { onLine: true });
    const { calls } = stubFetchCapturing(jsonResponse({ ok: true }, { status: 200 }));

    await networkBoundary(URL_UNDER_TEST);
    expect(calls[0]!.has("x-request-id")).toBe(false);
  });

  it("does NOT stamp x-request-id on the server (no document) — the header is absent", async () => {
    // No `document` global => outboundCorrelationId() returns undefined; the bound
    // active value / response-header lift cover the server trace instead.
    vi.stubGlobal("navigator", { onLine: true });
    const { calls } = stubFetchCapturing(jsonResponse({ ok: true }, { status: 200 }));

    await networkBoundary(URL_UNDER_TEST);
    expect(calls[0]!.has("x-request-id")).toBe(false);
  });
});
