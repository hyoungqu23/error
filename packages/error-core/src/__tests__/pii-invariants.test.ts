// §8-5 (P7) — PII 불변식: 커널 산출 단계에서 PII가 새지 않는다.
// sentryBeforeSend 스크럽은 Sentry sink 하나만 커버하므로(RFC §8-5), 커널이 만들어 내보내는
// 모든 산출물 — telemetry fingerprint/tags, wire ClientErrorPayload, 메시지 카탈로그 카피 —
// 에 PII-금지 불변식을 직접 고정한다. (OperationMeta.piiRisk의 결정-엔진 활용은 후속 백로그.)
import { describe, it, expect } from "vitest";

import { CANONICAL_ERROR_SEMANTICS } from "@/error/decision/catalog";
import type { ErrorCode } from "@/error/decision/codes";
import { resolveErrorDecision } from "@/error/decision/resolve";
import { createDecisionSystem, appError } from "@/error/decision/system";
import { FALLBACK_MESSAGES } from "@/error/translator";
import type { ErrorSemantics, OccurrenceContext } from "@/error/decision/types";

const PII_EMAIL = "leak.victim@example.com";
const PII_TOKEN = "Bearer abcdefghijklmnopqrstuvwxyz0123456789ABCDEF";
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]+/;
const TOKEN_RE = /\b(?:eyJ[\w-]{10,}|[A-Za-z0-9_-]{40,}|Bearer\s+[\w.-]+)\b/;

const CODES = Object.keys(CANONICAL_ERROR_SEMANTICS) as ErrorCode[];

const OCC: OccurrenceContext<"checkout"> = {
  operation: "checkout",
  interaction: "mutation",
  uiScope: "form",
  criticality: "core",
};

describe("§8-5 PII invariants (P7)", () => {
  it("catalog message keys + fallback copy carry no PII-shaped content (static)", () => {
    for (const code of CODES) {
      const s: ErrorSemantics = CANONICAL_ERROR_SEMANTICS[code];
      const keys = [s.defaultMessageKey, ...Object.values(s.messageKeys ?? {})];
      for (const key of keys) {
        // i18n 키 형태 강제 — 자유 텍스트(공백/'@' = PII 운반 가능)가 키 자리에 들어올 수 없다.
        expect(key).toMatch(/^error\.[a-zA-Z0-9._-]+$/);
      }
      expect(EMAIL_RE.test(FALLBACK_MESSAGES[code])).toBe(false);
      expect(TOKEN_RE.test(FALLBACK_MESSAGES[code])).toBe(false);
    }
  });

  it.each(CODES)(
    "resolved telemetry for %s never leaks message/details into fingerprint/tags (fixed vocabulary)",
    (code) => {
      const error = appError(
        code,
        { email: PII_EMAIL, token: PII_TOKEN },
        { message: `boom ${PII_EMAIL} ${PII_TOKEN}` },
      );
      const decision = resolveErrorDecision({
        error,
        semantics: CANONICAL_ERROR_SEMANTICS[code] as ErrorSemantics,
        occurrence: OCC,
        runtime: { runtime: "server", correlationId: "c1" },
      });

      const telemetryWire = JSON.stringify({
        fingerprint: decision.telemetry.fingerprint,
        tags: decision.telemetry.tags,
      });
      expect(EMAIL_RE.test(telemetryWire)).toBe(false);
      expect(TOKEN_RE.test(telemetryWire)).toBe(false);
      // 고정 어휘 — fingerprint는 [operation, code, interaction], tags 키 집합은 결정 입력의
      // 분류 축뿐이다. message/details 값은 구조적으로 들어올 수 없다.
      expect(decision.telemetry.fingerprint).toEqual(["checkout", code, "mutation"]);
      expect(Object.keys(decision.telemetry.tags ?? {}).sort()).toEqual([
        "criticality",
        "operation",
        "runtime",
        "surface",
      ]);
    },
  );

  it("ClientErrorPayload never carries a `message` key; non-allowlisted PII details are stripped (all 15 codes)", () => {
    const sys = createDecisionSystem({
      errors: CANONICAL_ERROR_SEMANTICS,
      operations: {
        checkout: {
          operation: "checkout",
          owner: "team-errors",
          criticality: "core",
          defaultUiScope: "form",
          piiRisk: true,
        },
      },
      fallbackErrorCode: "UNKNOWN_SERVER_ERROR",
    });

    for (const code of CODES) {
      // PII details는 어떤 코드의 allowlist에도 없다(fieldErrors/retryAfterMs뿐). validateDetails
      // 보유 코드(VALIDATION/RATE_LIMITED)는 D1 게이트가 fallback으로 degrade — 그 경로 포함
      // 어느 쪽이든 wire에 PII가 실리면 안 된다.
      const failure = sys.finalizeUnknown(
        appError(code, { email: PII_EMAIL, token: PII_TOKEN }, { message: `boom ${PII_EMAIL}` }),
        OCC,
        { runtime: "server", correlationId: "c1" },
      );

      expect("message" in failure.payload).toBe(false);
      const wire = JSON.stringify(failure.payload);
      expect(EMAIL_RE.test(wire)).toBe(false);
      expect(TOKEN_RE.test(wire)).toBe(false);
    }
  });
});
