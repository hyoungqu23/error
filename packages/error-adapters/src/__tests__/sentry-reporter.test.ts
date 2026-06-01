import { describe, expect, it } from "vitest";

import { sentryBeforeSend } from "@/error/adapters/sentry-reporter";

describe("sentryBeforeSend", () => {
  it("scrubs PII from user, extra, contexts, request headers, cookies, messages, and exceptions", () => {
    const event = sentryBeforeSend({
      user: {
        id: "u1",
        email: "user@example.com",
        ip_address: "127.0.0.1",
        username: "person",
      },
      extra: {
        authorization: "Bearer abc.def.ghi",
        nested: { token: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK" },
      },
      contexts: {
        app: {
          cookie: "sid=secret",
          safe: "value",
        },
      },
      request: {
        headers: {
          authorization: "Bearer top-secret",
          cookie: "sid=secret",
          "x-safe": "ok",
        },
        cookies: { sid: "secret" },
      },
      message: "failed with Bearer abc.def.ghi",
      exception: {
        values: [{ value: "token abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK leaked" }],
      },
    } as unknown as Parameters<typeof sentryBeforeSend>[0]);

    expect(event).not.toBeNull();
    expect(event?.user).toEqual({ id: "u1" });
    expect(event?.extra?.authorization).toBe("[redacted]");
    expect(JSON.stringify(event?.extra)).not.toContain("ABCDEFGHIJK");
    expect(JSON.stringify(event?.contexts)).not.toContain("sid=secret");
    expect(event?.request?.headers?.authorization).toBe("[redacted]");
    expect(event?.request?.headers?.cookie).toBe("[redacted]");
    expect(event?.request?.headers?.["x-safe"]).toBe("ok");
    expect(event?.request?.cookies).toBeUndefined();
    expect(event?.message).toBe("failed with [redacted-token]");
    expect(event?.exception?.values?.[0]?.value).toContain("[redacted-token]");
  });
});
