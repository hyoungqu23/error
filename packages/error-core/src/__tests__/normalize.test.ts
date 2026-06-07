// normalize.ts — tryNormalizeKnownError의 프레임워크/네트워크 매핑 계약 특성화.
//
// 핀하는 계약(Red Team CRITICAL — mapKnownError 구조화 + 메시지 앵커링):
//   - timeout은 구조 신호(name "TimeoutError" / code "ETIMEDOUT")로만 판별한다 — 메시지 매칭
//     금지("session timeout exceeded" 같은 진짜 fault를 operational TIMEOUT으로 강등하지 않음).
//   - fetch는 name "TypeError" + 알려진 fetch 실패 문구 세트만 — 코드 버그성 TypeError
//     ("Cannot read properties of undefined …")를 NETWORK_ERROR로 오분류하지 않음.
//   - OFFLINE 분기는 navigator.onLine === false일 때만(R2 / testing INFO).
//
// 이 테스트는 raw 입력 인식만 핀한다: tryNormalizeKnownError는 promoter이므로 known 코드 또는
// null만 반환하고(UNKNOWN_* 폴백 없음), 미인식 시 null이다.
import { afterEach, describe, expect, it, vi } from "vitest";

import { tryNormalizeKnownError } from "@/error/normalize";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("tryNormalizeKnownError — mapKnownError 구조화 (Red Team CRITICAL)", () => {
  it("① 코드 버그성 TypeError(fetch 무관 메시지)는 NETWORK_ERROR로 승격되지 않는다 (null)", () => {
    const codeBug = new TypeError("Cannot read properties of undefined (reading 'fetch')");
    expect(tryNormalizeKnownError(codeBug)).toBeNull();
  });

  it("② 메시지에 timeout이 든 진짜 fault Error는 TIMEOUT으로 강등되지 않는다 (null)", () => {
    const sessionFault = new Error("session timeout exceeded");
    expect(tryNormalizeKnownError(sessionFault)).toBeNull();
  });

  it("③ TypeError('Failed to fetch') → NETWORK_ERROR (기존 유지)", () => {
    const fetchFail = new TypeError("Failed to fetch");
    expect(tryNormalizeKnownError(fetchFail)?.code).toBe("NETWORK_ERROR");
  });

  it("④ name 'TimeoutError' → TIMEOUT (구조 신호)", () => {
    const timeout = Object.assign(new Error("whatever"), { name: "TimeoutError" });
    expect(tryNormalizeKnownError(timeout)?.code).toBe("TIMEOUT");
  });

  it("⑤ Node 형태 code 'ETIMEDOUT' → TIMEOUT (구조 신호)", () => {
    const etimedout = Object.assign(new Error("connect ETIMEDOUT 1.2.3.4"), { code: "ETIMEDOUT" });
    expect(tryNormalizeKnownError(etimedout)?.code).toBe("TIMEOUT");
  });

  it("다른 브라우저/런타임의 fetch 실패 문구도 NETWORK_ERROR로 매핑 (앵커링된 세트)", () => {
    for (const msg of [
      "fetch failed", // undici
      "NetworkError when attempting to fetch resource.", // Firefox
      "Network request failed", // React Native
      "Load failed", // Safari
    ]) {
      expect(tryNormalizeKnownError(new TypeError(msg))?.code).toBe("NETWORK_ERROR");
    }
  });
});

describe("tryNormalizeKnownError — OFFLINE 분기 (R2)", () => {
  it("navigator.onLine === false에서 TypeError('Failed to fetch') → OFFLINE", () => {
    vi.stubGlobal("navigator", { onLine: false });
    const fetchFail = new TypeError("Failed to fetch");
    expect(tryNormalizeKnownError(fetchFail)?.code).toBe("OFFLINE");
  });
});
