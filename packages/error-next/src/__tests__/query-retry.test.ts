// §10 retryable wiring — makeQueryClient() retry predicate + retryDelay, and withRetry().
//
// Runs under the `node` test environment, so getRuntime() === "server": the active
// registry resolves to DEFAULT_ERROR_REGISTRY (no per-request store bound here), which
// means DomainError.retryable reflects the registry table exactly as written.
import { describe, it, expect } from "vitest";
import type { QueryClient } from "@tanstack/react-query";

import { makeQueryClient, MAX_QUERY_RETRIES } from "@/error/query-client";
import { withRetry } from "@/error/with-retry";
import { makeError } from "@/error/make-error";
import { DomainError } from "@/error/app-error";
import { DEFAULT_BACKOFF } from "@/error/backoff";

// ── helpers ────────────────────────────────────────────────────────────────
// TanStack's resolved default option types model retry/retryDelay as broad unions
// (boolean | number | fn). Pull the function form out via the public accessor.
type RetryPredicate = (failureCount: number, error: unknown) => boolean;
type RetryDelayFn = (attempt: number, error: unknown) => number;

const getRetryPredicate = (client: QueryClient): RetryPredicate => {
  const retry = client.getDefaultOptions().queries?.retry;
  if (typeof retry !== "function") {
    throw new Error("expected queries.retry to be a predicate function");
  }
  return retry as RetryPredicate;
};

const getRetryDelay = (client: QueryClient): RetryDelayFn => {
  const retryDelay = client.getDefaultOptions().queries?.retryDelay;
  if (typeof retryDelay !== "function") {
    throw new Error("expected queries.retryDelay to be a function");
  }
  return retryDelay as RetryDelayFn;
};

describe("makeQueryClient() retry predicate (queries.retry)", () => {
  it("never retries a non-retryable DomainError (NOT_FOUND, retryable:false)", () => {
    const retry = getRetryPredicate(makeQueryClient());
    const notFound = makeError({ code: "NOT_FOUND", details: { resource: "doc" } });

    // sanity: the registry flag we depend on
    expect(notFound.retryable).toBe(false);
    // false at every count, including the very first failure
    expect(retry(0, notFound)).toBe(false);
    expect(retry(1, notFound)).toBe(false);
    expect(retry(2, notFound)).toBe(false);
  });

  it.each(["OFFLINE", "TIMEOUT", "HTTP_SERVER_ERROR"] as const)(
    "retries a retryable code (%s) while count < cap, then stops at the cap",
    (code) => {
      const retry = getRetryPredicate(makeQueryClient());
      const details =
        code === "HTTP_SERVER_ERROR" ? ({ status: 500 } as const) : null;
      const err = makeError({ code, details } as Parameters<typeof makeError>[0]);

      expect(err.retryable).toBe(true);
      // retried while failureCount < MAX_QUERY_RETRIES (0-based count)
      for (let count = 0; count < MAX_QUERY_RETRIES; count += 1) {
        expect(retry(count, err)).toBe(true);
      }
      // at the cap and beyond → no more retries
      expect(retry(MAX_QUERY_RETRIES, err)).toBe(false);
      expect(retry(MAX_QUERY_RETRIES + 5, err)).toBe(false);
    },
  );

  it("does not retry a non-DomainError throw", () => {
    const retry = getRetryPredicate(makeQueryClient());
    expect(retry(0, new Error("plain"))).toBe(false);
    expect(retry(0, "a string")).toBe(false);
    expect(retry(0, null)).toBe(false);
    expect(retry(0, { code: "OFFLINE", retryable: true })).toBe(false); // shape-only impostor
  });
});

describe("makeQueryClient() retryDelay (queries.retryDelay)", () => {
  it("prefers a Retry-After hint (RATE_LIMITED details.retryAfterMs) over expo+jitter", () => {
    const retryDelay = getRetryDelay(makeQueryClient());
    const hintMs = 4_200;
    const rateLimited = makeError({
      code: "RATE_LIMITED",
      details: { retryAfterMs: hintMs },
    });

    // The hint is honored exactly (well under maxMs), independent of attempt index,
    // so it is NOT the random expo+jitter value (which varies with attempt).
    expect(retryDelay(0, rateLimited)).toBe(hintMs);
    expect(retryDelay(1, rateLimited)).toBe(hintMs);
    expect(retryDelay(7, rateLimited)).toBe(hintMs);
  });

  it("clamps an oversized Retry-After hint to maxMs", () => {
    const retryDelay = getRetryDelay(makeQueryClient());
    const huge = makeError({
      code: "RATE_LIMITED",
      details: { retryAfterMs: 3_600_000 }, // 1 hour
    });
    expect(retryDelay(0, huge)).toBe(DEFAULT_BACKOFF.maxMs);
  });

  it("falls back to full-jitter expo backoff when there is no hint", () => {
    const retryDelay = getRetryDelay(makeQueryClient());
    // RATE_LIMITED with no retryAfterMs → no hint → jittered backoff in [0, base*2^attempt]
    const noHint = makeError({ code: "RATE_LIMITED", details: null });
    const samples = Array.from({ length: 50 }, () => retryDelay(2, noHint));
    const ceiling = Math.min(
      DEFAULT_BACKOFF.maxMs,
      DEFAULT_BACKOFF.baseMs * 2 ** 2,
    );
    for (const d of samples) {
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(ceiling);
    }
  });
});

describe("withRetry() honors DomainError.retryable", () => {
  it("throws a non-retryable DomainError immediately (zero retries)", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const notFound = makeError({ code: "NOT_FOUND", details: { resource: "x" } });

    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw notFound;
        },
        { sleep: async (ms) => void sleeps.push(ms), rand: () => 0 },
      ),
    ).rejects.toBe(notFound);

    expect(calls).toBe(1); // invoked exactly once — never retried
    expect(sleeps).toHaveLength(0); // never slept
  });

  it("propagates a non-DomainError throw immediately", async () => {
    let calls = 0;
    const boom = new Error("boom");
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw boom;
        },
        { sleep: async () => {} },
      ),
    ).rejects.toBe(boom);
    expect(calls).toBe(1);
  });

  it("retries a retryable DomainError then succeeds, sleeping between attempts", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const offline = makeError({ code: "OFFLINE", details: null });
    expect(offline.retryable).toBe(true);
    expect(offline).toBeInstanceOf(DomainError);

    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw offline; // fail twice, then succeed
        return "ok" as const;
      },
      { sleep: async (ms) => void sleeps.push(ms), rand: () => 0 },
    );

    expect(result).toBe("ok");
    expect(calls).toBe(3); // initial + 2 retries
    expect(sleeps).toHaveLength(2); // slept before each of the 2 retries
  });

  it("stops after maxRetries and rethrows the last retryable error", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const timeout = makeError({ code: "TIMEOUT", details: null });

    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw timeout; // always fails
        },
        { maxRetries: 2, sleep: async (ms) => void sleeps.push(ms), rand: () => 0 },
      ),
    ).rejects.toBe(timeout);

    expect(calls).toBe(3); // initial + maxRetries(2)
    expect(sleeps).toHaveLength(2);
  });

  it("withRetry prefers the RATE_LIMITED Retry-After hint for its sleep delay", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const rateLimited = makeError({
      code: "RATE_LIMITED",
      details: { retryAfterMs: 2_500 },
    });

    const out = await withRetry(
      async () => {
        calls += 1;
        if (calls < 2) throw rateLimited;
        return 42;
      },
      // rand:()=>0 would make jitter 0; a non-zero hint proves the hint path is taken
      { sleep: async (ms) => void sleeps.push(ms), rand: () => 0 },
    );

    expect(out).toBe(42);
    expect(sleeps).toEqual([2_500]);
  });
});
