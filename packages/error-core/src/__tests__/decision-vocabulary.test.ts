import { describe, it, expect } from "vitest";
import { DEFAULT_ERROR_REGISTRY } from "../registry";
import { CANONICAL_ERROR_SEMANTICS } from "../decision/catalog";
import type { ErrorCatalog } from "../decision/types";

const CATALOG: ErrorCatalog = CANONICAL_ERROR_SEMANTICS;

describe("CANONICAL_ERROR_SEMANTICS", () => {
  it("covers every code in DEFAULT_ERROR_REGISTRY", () => {
    for (const code of Object.keys(DEFAULT_ERROR_REGISTRY)) {
      expect(CATALOG[code], `missing semantics for ${code}`).toBeDefined();
    }
  });

  it("preserves category(kind), httpStatus, retryable, messageKey from the registry", () => {
    for (const [code, meta] of Object.entries(DEFAULT_ERROR_REGISTRY)) {
      const sem = CATALOG[code]!;
      expect(sem.category).toBe(meta.kind);
      expect(sem.defaultHttpStatus).toBe(meta.httpStatus);
      expect(sem.defaultRetryable).toBe(meta.retryable);
      expect(sem.defaultMessageKey).toBe(meta.userMessageKey);
    }
  });
});
