// §10 — mutation Result path: safeFormAction (+ safeServerAction) boundary.
//
// We unit-test the REAL safeFormAction / safeServerAction control-flow + reporting
// plumbing in Node. Two things are mocked so no Next runtime / headers() / React
// cache() is touched:
//   1. @/error/request-handler.server  → getRequestHandler returns a spyable no-op
//      handler (the unexpected-error reporting sink). This also short-circuits
//      next/headers + crypto in the real module.
//   2. next/navigation                 → unstable_rethrow re-throws iff the caught
//      value carries a NEXT_REDIRECT digest (the real contract), else returns. The
//      real next-control-flow.ts is exercised against this mock.
//
// In Node, getRuntime() === "server" (the server reporting path is exercised). Track-1 vs
// Track-2 is decided by the static catalog category (P5 — the old active-registry /
// isExpectedCode are gone): CANONICAL_ERROR_SEMANTICS["NOT_FOUND"].category === "business"
// (→ Failure, not reported); "HTTP_SERVER_ERROR" is "fault" (→ reported + rethrown).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

// --- mock #1: the per-request server handler (the unexpected-error sink) ------------
// Hoisted spy so each test can assert it received the unexpected error untouched.
const handleServerError = vi.fn<(input: unknown) => unknown>(
  () => ({}) as unknown,
);
vi.mock("@/error/request-handler.server", () => ({
  // safeFormAction/safeServerAction do `await getRequestHandler()` → returns the handler.
  getRequestHandler: vi.fn(async () => handleServerError),
}));

// --- mock #2: next/navigation control-flow signal -----------------------------------
// unstable_rethrow throws iff `e` is a framework signal (here: a NEXT_REDIRECT digest),
// returns otherwise. This mirrors next@15.5's behavior closely enough that the REAL
// next-control-flow.ts rethrowControlFlow() re-surfaces redirects and passes the rest.
const REDIRECT_DIGEST = "NEXT_REDIRECT;replace;/login;307;";
vi.mock("next/navigation", () => ({
  unstable_rethrow: (e: unknown) => {
    if (
      typeof e === "object" &&
      e !== null &&
      "digest" in e &&
      typeof (e as { digest: unknown }).digest === "string" &&
      (e as { digest: string }).digest.startsWith("NEXT_REDIRECT")
    ) {
      throw e;
    }
  },
}));

import { safeFormAction } from "@/error/safe-form-action";
import { safeServerAction } from "@/error/safe-server-action";
import type { FormState } from "@/error/safe-form-action";
import type { FormValidator } from "../form-validator";
import { makeError } from "@/error/make-error";
import type { Result } from "@/error/result";

const schema = z.object({ id: z.string().min(1), count: z.coerce.number().int() });
type In = z.infer<typeof schema>;

const fd = (entries: Record<string, string>): FormData => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
};

beforeEach(() => {
  handleServerError.mockClear();
});

describe("safeFormAction — §10 mutation Result path", () => {
  it("invalid FormData → Failure with VALIDATION code and populated fieldErrors", async () => {
    const action = safeFormAction(schema, async (data: In) => ({ id: data.id }));
    // Missing `id` (empty) and non-numeric `count` → two field failures.
    const result = await action(null, fd({ id: "", count: "not-a-number" }));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected Failure");
    expect(result.error.code).toBe("VALIDATION");
    expect(result.error.messageKey).toBe("error.validation");
    // VALIDATION is the one code whose `fieldErrors` are allowlisted to the client.
    const details = result.error.details as { fieldErrors: Record<string, string[]> };
    expect(details.fieldErrors).toBeDefined();
    expect(details.fieldErrors.id?.length ?? 0).toBeGreaterThan(0);
    expect(details.fieldErrors.count?.length ?? 0).toBeGreaterThan(0);
    // Validation failure must NOT report through the unexpected sink.
    expect(handleServerError).not.toHaveBeenCalled();
  });

  it("valid FormData → Success carrying the action's return; action sees parsed data", async () => {
    const seen: In[] = [];
    const action = safeFormAction(schema, async (data: In) => {
      seen.push(data);
      return { id: data.id, count: data.count };
    });
    const result = await action(null, fd({ id: "abc", count: "42" }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected Success");
    expect(result.data).toEqual({ id: "abc", count: 42 });
    // Zod coerced "42" → number 42 before the action ran.
    expect(seen).toEqual([{ id: "abc", count: 42 }]);
    expect(handleServerError).not.toHaveBeenCalled();
  });

  it("duplicate FormData field names are preserved as arrays for Zod", async () => {
    const tagsSchema = z.object({ tag: z.array(z.string()).min(2) });
    const action = safeFormAction(tagsSchema, async (data) => ({ tags: data.tag }));
    const form = new FormData();
    form.append("tag", "alpha");
    form.append("tag", "beta");

    const result = await action(null, form);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected Success");
    expect(result.data).toEqual({ tags: ["alpha", "beta"] });
    expect(handleServerError).not.toHaveBeenCalled();
  });

  it("action throwing an EXPECTED DomainError → Failure (returned, not thrown, not reported)", async () => {
    const expectedErr = makeError({ code: "NOT_FOUND", details: { resource: "secret-table" } });
    const action = safeFormAction(schema, async (_data: In) => {
      throw expectedErr;
      return { id: "" };
    });

    const result = await action(null, fd({ id: "abc", count: "1" }));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected Failure");
    expect(result.error.code).toBe("NOT_FOUND");
    expect(result.error.messageKey).toBe("error.notFound");
    // NOT_FOUND.resource is intentionally withheld from the client allowlist.
    expect(result.error.details).toBeUndefined();
    // Expected business error is Track-1: returned, never sent to the unexpected sink.
    expect(handleServerError).not.toHaveBeenCalled();
  });

  it("action throwing an UNEXPECTED error → reports via getRequestHandler then re-throws", async () => {
    const boom = new Error("db exploded");
    const action = safeFormAction(schema, async (_data: In) => {
      throw boom;
      return { id: "" };
    });

    await expect(action(null, fd({ id: "abc", count: "1" }))).rejects.toBe(boom);
    expect(handleServerError).toHaveBeenCalledTimes(1);
    expect(handleServerError).toHaveBeenCalledWith(boom);
  });

  it("action throwing an UNEXPECTED (non-expected code) DomainError → reports + re-throws", async () => {
    // HTTP_SERVER_ERROR has expected:false → falls through Track-1, hits Track-2.
    const serverErr = makeError({ code: "HTTP_SERVER_ERROR", details: { status: 500 } });
    const action = safeFormAction(schema, async (_data: In) => {
      throw serverErr;
      return { id: "" };
    });

    await expect(action(null, fd({ id: "abc", count: "1" }))).rejects.toBe(serverErr);
    expect(handleServerError).toHaveBeenCalledTimes(1);
    expect(handleServerError).toHaveBeenCalledWith(serverErr);
  });

  it("thrown redirect control-flow signal is re-thrown UNTOUCHED and never reported", async () => {
    // A Next redirect() throws an object bearing a NEXT_REDIRECT digest.
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: REDIRECT_DIGEST });
    const action = safeFormAction(schema, async (_data: In) => {
      throw redirect;
      return { id: "" };
    });

    await expect(action(null, fd({ id: "abc", count: "1" }))).rejects.toBe(redirect);
    // Control flow is re-surfaced BEFORE the report branch — sink must stay clean.
    expect(handleServerError).not.toHaveBeenCalled();
  });

  it("(prevState, formData) calling convention type-composes and threads prevState to the action", async () => {
    const prevSeen: FormState<{ id: string }>[] = [];
    const action: (
      prevState: FormState<{ id: string }>,
      formData: FormData,
    ) => Promise<Result<{ id: string }>> = safeFormAction(
      schema,
      async (data: In, prevState: FormState<{ id: string }>) => {
        prevSeen.push(prevState);
        return { id: data.id };
      },
    );

    const prior: FormState<{ id: string }> = { ok: true, data: { id: "old" } };
    const result = await action(prior, fd({ id: "new", count: "2" }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected Success");
    expect(result.data).toEqual({ id: "new" });
    // The prior Result is handed to the action as prevState (useActionState convention).
    expect(prevSeen).toEqual([prior]);
  });
});

describe("safeServerAction — RPC-style sibling shares the same Result plumbing", () => {
  it("invalid input → VALIDATION Failure; valid → Success; no report on either", async () => {
    const action = safeServerAction(schema, async (data: In) => ({ id: data.id }));

    const bad = await action({ id: "", count: 1.5 } as In);
    expect(bad.ok).toBe(false);
    if (bad.ok) throw new Error("expected Failure");
    expect(bad.error.code).toBe("VALIDATION");

    const good = await action({ id: "x", count: 7 } as In);
    expect(good.ok).toBe(true);
    if (!good.ok) throw new Error("expected Success");
    expect(good.data).toEqual({ id: "x" });

    expect(handleServerError).not.toHaveBeenCalled();
  });

  it("expected DomainError → Failure; unexpected → report + re-throw; redirect → untouched", async () => {
    const expectedErr = makeError({ code: "NOT_FOUND", details: null });
    const expectedAction = safeServerAction(schema, async (_d: In) => {
      throw expectedErr;
    });
    const r = await expectedAction({ id: "x", count: 1 } as In);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected Failure");
    expect(r.error.code).toBe("NOT_FOUND");
    expect(handleServerError).not.toHaveBeenCalled();

    const boom = new Error("kaboom");
    const unexpectedAction = safeServerAction(schema, async (_d: In) => {
      throw boom;
    });
    await expect(unexpectedAction({ id: "x", count: 1 } as In)).rejects.toBe(boom);
    expect(handleServerError).toHaveBeenCalledWith(boom);

    handleServerError.mockClear();
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: REDIRECT_DIGEST });
    const redirectAction = safeServerAction(schema, async (_d: In) => {
      throw redirect;
    });
    await expect(redirectAction({ id: "x", count: 1 } as In)).rejects.toBe(redirect);
    expect(handleServerError).not.toHaveBeenCalled();
  });
});

describe("safeFormAction — validator-agnostic (custom FormValidator)", () => {
  it("(a) custom validator ok → Success carrying the action's return; action sees parsed data", async () => {
    const seen: { name: string }[] = [];
    // zod에 의존하지 않는 순수 FormValidator — input(unknown)을 직접 좁혀 {name}으로 정규화한다.
    const validator: FormValidator<{ name: string }> = {
      parse: (input) => {
        const obj = input as Record<string, unknown>;
        return { ok: true, data: { name: String(obj.name ?? "") } };
      },
    };
    const action = safeFormAction(validator, async (data) => {
      seen.push(data);
      return { greeting: `hi ${data.name}` };
    });

    const result = await action(null, fd({ name: "ada" }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected Success");
    expect(result.data).toEqual({ greeting: "hi ada" });
    expect(seen).toEqual([{ name: "ada" }]);
    expect(handleServerError).not.toHaveBeenCalled();
  });

  it("(b) custom validator fieldErrors + formError → VALIDATION Failure with _form joined into fieldErrors", async () => {
    const validator: FormValidator<{ name: string }> = {
      parse: () => ({
        ok: false,
        fieldErrors: { name: ["required"] },
        formError: "form is invalid",
      }),
    };
    const action = safeFormAction(validator, async (data) => ({ name: data.name }));

    const result = await action(null, fd({ name: "" }));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected Failure");
    expect(result.error.code).toBe("VALIDATION");
    const details = result.error.details as { fieldErrors: Record<string, string[]> };
    expect(details.fieldErrors.name).toEqual(["required"]);
    // formError는 fieldErrors의 예약 키 _form으로 합류해 allowlist/validateDetails를 통과한다.
    expect(details.fieldErrors._form).toEqual(["form is invalid"]);
    expect(handleServerError).not.toHaveBeenCalled();
  });

  it("(c) custom validator throwing → reports via getRequestHandler then re-throws (unexpected path)", async () => {
    const boom = new Error("validator exploded");
    const validator: FormValidator<{ name: string }> = {
      parse: () => {
        throw boom;
      },
    };
    const action = safeFormAction(validator, async (data) => ({ name: data.name }));

    await expect(action(null, fd({ name: "x" }))).rejects.toBe(boom);
    expect(handleServerError).toHaveBeenCalledTimes(1);
    expect(handleServerError).toHaveBeenCalledWith(boom);
  });

  // P0a 리뷰 봉인: zod 오버로드 경로의 **의도된 동작 변경** — 이전엔 flatten().formErrors(루트/
  // refine 오류)가 조용히 버려졌으나, 이제 zodFormValidator를 경유하며 _form으로 wire에 실린다.
  it("(d) zod root-level refine error → details.fieldErrors._form (intended behavior change, sealed)", async () => {
    const refined = z
      .object({ a: z.string(), b: z.string() })
      .refine((v) => v.a !== v.b, { message: "a와 b는 달라야 합니다" });
    const action = safeFormAction(refined, async (data) => ({ a: data.a }));

    const result = await action(null, fd({ a: "same", b: "same" }));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected Failure");
    expect(result.error.code).toBe("VALIDATION");
    const details = result.error.details as { fieldErrors: Record<string, string[]> };
    expect(details.fieldErrors._form).toEqual(["a와 b는 달라야 합니다"]);
  });
});

describe("safeServerAction — validator-agnostic (P0a 리뷰: 두 경계의 wire shape 통일)", () => {
  it("custom FormValidator ok → Success; fieldErrors+formError → VALIDATION Failure with _form", async () => {
    const validator: FormValidator<{ n: number }> = {
      parse: (input) => {
        const obj = input as Record<string, unknown>;
        return typeof obj.n === "number"
          ? { ok: true, data: { n: obj.n } }
          : { ok: false, fieldErrors: { n: ["number required"] }, formError: "bad payload" };
      },
    };
    const action = safeServerAction(validator, async (data) => ({ doubled: data.n * 2 }));

    const good = await action({ n: 21 });
    expect(good.ok).toBe(true);
    if (!good.ok) throw new Error("expected Success");
    expect(good.data).toEqual({ doubled: 42 });

    const bad = await action({ n: "no" });
    expect(bad.ok).toBe(false);
    if (bad.ok) throw new Error("expected Failure");
    expect(bad.error.code).toBe("VALIDATION");
    const details = bad.error.details as { fieldErrors: Record<string, string[]> };
    expect(details.fieldErrors.n).toEqual(["number required"]);
    expect(details.fieldErrors._form).toEqual(["bad payload"]);
    expect(handleServerError).not.toHaveBeenCalled();
  });

  it("zod root-level refine error → _form (same wire shape as safeFormAction)", async () => {
    const refined = z
      .object({ a: z.string(), b: z.string() })
      .refine((v) => v.a !== v.b, { message: "a/b 충돌" });
    const action = safeServerAction(refined, async (data) => ({ a: data.a }));

    const r = await action({ a: "x", b: "x" });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected Failure");
    const details = r.error.details as { fieldErrors: Record<string, string[]> };
    expect(details.fieldErrors._form).toEqual(["a/b 충돌"]);
  });
});
