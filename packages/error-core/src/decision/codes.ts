// error-core/decision/codes.ts — 알려진 에러 코드 SSOT. 정본 = 통합 카탈로그(CANONICAL_ERROR_SEMANTICS).
// (P3e: DEFAULT_ERROR_REGISTRY 의존 제거 — registry.ts는 Task 6에서 삭제된다.)
import { CANONICAL_ERROR_SEMANTICS } from "./catalog";

export type ErrorCode = keyof typeof CANONICAL_ERROR_SEMANTICS;
export const KNOWN_ERROR_CODES: ReadonlySet<string> = new Set(Object.keys(CANONICAL_ERROR_SEMANTICS));
export const isKnownErrorCode = (code: string): code is ErrorCode => KNOWN_ERROR_CODES.has(code);
