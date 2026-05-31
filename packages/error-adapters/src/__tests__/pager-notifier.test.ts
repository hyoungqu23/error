// t-new (G7) — adapters/pager-notifier.ts
//
// createPagerNotifier(transport, options) wraps an in-process per-dedupKey suppressor
// (one page per dedupKey per window) so a refresh/retry storm of the SAME incident
// does not flood the pager webhook. The dedupKey is `${code}:${route}`.
// webhookPagerTransport(url) POSTs with an AbortSignal.timeout(5000) so a hung webhook
// cannot leak a dangling request.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { createPagerNotifier, webhookPagerTransport } from "@/error/adapters/pager-notifier";
import type { PagerTransport, PageEvent } from "@/error/adapters/pager-notifier";
import { makeError } from "@/error/make-error";
import type { TelemetryContext } from "@/error/telemetry";

const ctxFor = (route: string): TelemetryContext => ({
  runtime: "server",
  correlationId: "c1",
  route,
  user: null,
});

const recordingTransport = () => {
  const events: PageEvent[] = [];
  const transport: PagerTransport = {
    send: vi.fn(async (e: PageEvent) => {
      events.push(e);
    }),
  };
  return { transport, events };
};

describe("createPagerNotifier suppressor (G7)", () => {
  it("pages once per dedupKey per window; suppresses repeats inside the window", () => {
    let clock = 0;
    const { transport } = recordingTransport();
    const notifier = createPagerNotifier(transport, {
      dedupWindowMs: 60_000,
      now: () => clock,
    });
    const error = makeError({ code: "HTTP_SERVER_ERROR", details: { status: 500 } });
    const ctx = ctxFor("/checkout");

    // First page for the dedupKey passes.
    notifier.notify(error, "fatal", ctx);
    // A storm of the same incident inside the window is suppressed.
    clock = 10_000;
    notifier.notify(error, "fatal", ctx);
    clock = 59_999;
    notifier.notify(error, "fatal", ctx);

    expect(transport.send).toHaveBeenCalledTimes(1);
  });

  it("allows a new page for the same dedupKey once the window elapses", () => {
    let clock = 0;
    const { transport } = recordingTransport();
    const notifier = createPagerNotifier(transport, {
      dedupWindowMs: 60_000,
      now: () => clock,
    });
    const error = makeError({ code: "HTTP_SERVER_ERROR", details: { status: 500 } });
    const ctx = ctxFor("/checkout");

    notifier.notify(error, "fatal", ctx);
    clock = 60_000; // window elapsed (t - prev === windowMs is NOT < windowMs → allow)
    notifier.notify(error, "fatal", ctx);

    expect(transport.send).toHaveBeenCalledTimes(2);
  });

  it("keys the suppressor per dedupKey (code+route) so distinct incidents both page", () => {
    let clock = 0;
    const { transport, events } = recordingTransport();
    const notifier = createPagerNotifier(transport, {
      dedupWindowMs: 60_000,
      now: () => clock,
    });
    const error = makeError({ code: "HTTP_SERVER_ERROR", details: { status: 500 } });

    // Same code, DIFFERENT route → different dedupKey → both page.
    notifier.notify(error, "fatal", ctxFor("/a"));
    notifier.notify(error, "fatal", ctxFor("/b"));

    expect(transport.send).toHaveBeenCalledTimes(2);
    expect(events.map((e) => e.dedupKey)).toEqual([
      "HTTP_SERVER_ERROR:/a",
      "HTTP_SERVER_ERROR:/b",
    ]);
  });

  it("swallows a transport failure (alerting must never throw into the app)", () => {
    const transport: PagerTransport = { send: vi.fn(async () => Promise.reject(new Error("down"))) };
    const notifier = createPagerNotifier(transport);
    const error = makeError({ code: "HTTP_SERVER_ERROR", details: { status: 500 } });

    expect(() => notifier.notify(error, "fatal", ctxFor("/x"))).not.toThrow();
    expect(transport.send).toHaveBeenCalledTimes(1);
  });
});

describe("webhookPagerTransport (G7 — bounded outbound call)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to the webhook with an AbortSignal so a hung webhook cannot dangle", async () => {
    const transport = webhookPagerTransport("https://hooks.example/slack");
    const event: PageEvent = {
      title: "[FATAL] HTTP_SERVER_ERROR: boom",
      severity: "fatal",
      code: "HTTP_SERVER_ERROR",
      correlationId: "c1",
      route: "/checkout",
      runtime: "server",
      dedupKey: "HTTP_SERVER_ERROR:/checkout",
    };

    await transport.send(event);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("https://hooks.example/slack");
    expect(init.method).toBe("POST");
    // The bounded call carries an AbortSignal (AbortSignal.timeout(5000)).
    expect(init.signal).toBeInstanceOf(AbortSignal);
    // Body carries the dedup_key + severity so the vendor can collapse the incident.
    const body = JSON.parse(String(init.body)) as { dedup_key: string; severity: string };
    expect(body.dedup_key).toBe("HTTP_SERVER_ERROR:/checkout");
    expect(body.severity).toBe("fatal");
  });
});
