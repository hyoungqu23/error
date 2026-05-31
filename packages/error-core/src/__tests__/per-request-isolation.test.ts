// §10.2 per-request isolation (no cross-request bleed).
//
// We test the ACTUAL isolation primitive that backs the request handler:
// active-registry's server-side AsyncLocalStorage scope (runWithErrorRegistry /
// getActiveErrorRegistry). The full getRequestHandler + next/headers() path
// requires a real Next request scope and is exercised by E2E; here we prove the
// underlying ALS guarantee that path relies on.
//
// vitest's default environment for *.test.ts is "node" (see vitest.config.ts),
// so `typeof window === "undefined"` is true => getRuntime() === "server" =>
// getActiveErrorRegistry() reads the AsyncLocalStorage store. No window stubbing
// needed; we assert the server branch is live up front.
import { describe, it, expect, beforeEach } from "vitest";
import {
  getActiveErrorRegistry,
  setActiveErrorRegistry,
  runWithErrorRegistry,
} from "@/error/active-registry";
import { DEFAULT_ERROR_REGISTRY, type ErrorRegistry } from "@/error/registry";
import { getRuntime } from "@/error/runtime";
import { DomainError } from "@/error/app-error";

// Build a distinct registry by cloning DEFAULT and re-stamping one observable
// field (httpStatus) on a single code. Identity AND a value differ from DEFAULT,
// so a bleed is detectable both by reference (===) and by behavior (httpStatus).
const makeRegistry = (validationHttpStatus: number): ErrorRegistry =>
  ({
    ...DEFAULT_ERROR_REGISTRY,
    VALIDATION: { ...DEFAULT_ERROR_REGISTRY.VALIDATION, httpStatus: validationHttpStatus as never },
  }) as ErrorRegistry;

const REG_A = makeRegistry(418); // request A's catalog
const REG_B = makeRegistry(451); // request B's catalog

describe("§10.2 active-registry AsyncLocalStorage per-request isolation", () => {
  beforeEach(() => {
    // Each test starts with no ambient scope. We never call setActiveErrorRegistry
    // on the server (it throws by design — verified below), so the only mutable
    // state is the lazily-created ALS, which is empty outside any run().
    expect(getRuntime()).toBe("server");
  });

  it("resolves to DEFAULT_ERROR_REGISTRY outside any runWithErrorRegistry scope", () => {
    expect(getActiveErrorRegistry()).toBe(DEFAULT_ERROR_REGISTRY);
  });

  it("inside a scope returns THAT scope's registry; reverts to DEFAULT after", () => {
    const seen = runWithErrorRegistry(REG_A, () => getActiveErrorRegistry());
    expect(seen).toBe(REG_A);
    // Scope is closed synchronously when work() returns => back to DEFAULT.
    expect(getActiveErrorRegistry()).toBe(DEFAULT_ERROR_REGISTRY);
  });

  it("nested scopes shadow then restore the enclosing registry (LIFO)", () => {
    runWithErrorRegistry(REG_A, () => {
      expect(getActiveErrorRegistry()).toBe(REG_A);
      runWithErrorRegistry(REG_B, () => {
        expect(getActiveErrorRegistry()).toBe(REG_B);
      });
      // Inner scope popped — A is restored, NOT bled to B or DEFAULT.
      expect(getActiveErrorRegistry()).toBe(REG_A);
    });
    expect(getActiveErrorRegistry()).toBe(DEFAULT_ERROR_REGISTRY);
  });

  it("INTERLEAVED async contexts (different registries) never cross-talk", async () => {
    // Two concurrent 'requests'. Each yields control to the event loop at every
    // step via awaited timers, forcing the scheduler to interleave them. ALS must
    // carry each context's registry across every await boundary with no bleed.
    const tick = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

    const request = async (reg: ErrorRegistry, expectedStatus: number): Promise<number[]> =>
      runWithErrorRegistry(reg, async () => {
        const reads: number[] = [];
        for (let i = 0; i < 4; i++) {
          // Stagger A and B so their awaits resolve in alternating order.
          await tick(reg === REG_A ? 1 : 2);
          const active = getActiveErrorRegistry();
          // Reference identity must hold across the await.
          expect(active).toBe(reg);
          // And a DomainError getter must resolve against THIS context's catalog,
          // proving the binding reaches consumers, not just the raw getter.
          const err = new DomainError({ code: "VALIDATION", details: { fieldErrors: {} } });
          expect(err.httpStatus).toBe(expectedStatus);
          reads.push(err.httpStatus);
        }
        return reads;
      });

    const [a, b] = await Promise.all([request(REG_A, 418), request(REG_B, 451)]);
    // Every read inside A saw 418; every read inside B saw 451 — no interleaving bled.
    expect(a).toEqual([418, 418, 418, 418]);
    expect(b).toEqual([451, 451, 451, 451]);
    // After both settle, the ambient scope is once again empty.
    expect(getActiveErrorRegistry()).toBe(DEFAULT_ERROR_REGISTRY);
  });

  it("a context that runs entirely WHILE another is suspended keeps its own registry", async () => {
    // Start A, suspend it mid-flight, run B fully to completion inside the gap,
    // then resume A. A must still read REG_A on resume (no leak from B's scope).
    let resumeA!: () => void;
    const aSuspended = new Promise<void>((res) => {
      resumeA = res;
    });

    const aResult: { before?: ErrorRegistry; after?: ErrorRegistry } = {};
    const aPromise = runWithErrorRegistry(REG_A, async () => {
      aResult.before = getActiveErrorRegistry();
      await aSuspended; // park A's continuation
      aResult.after = getActiveErrorRegistry();
    });

    // While A is parked, B runs start-to-finish in its own scope.
    const bSaw = await runWithErrorRegistry(REG_B, async () => {
      await Promise.resolve();
      return getActiveErrorRegistry();
    });
    expect(bSaw).toBe(REG_B);

    resumeA();
    await aPromise;
    expect(aResult.before).toBe(REG_A);
    expect(aResult.after).toBe(REG_A); // resumed with its OWN registry, not B's
    expect(getActiveErrorRegistry()).toBe(DEFAULT_ERROR_REGISTRY);
  });

  it("setActiveErrorRegistry is rejected on the server (forces the scoped API, prevents leak)", () => {
    // The client singleton-set is explicitly disallowed server-side precisely
    // because it would leak across requests; isolation is only via run().
    expect(() => setActiveErrorRegistry(REG_A)).toThrow(/client-only/i);
    // The throw must not have mutated ambient state.
    expect(getActiveErrorRegistry()).toBe(DEFAULT_ERROR_REGISTRY);
  });
});
