// error-core/decision/codes.ts — 알려진 에러 코드 SSOT(P3e에서 registry.ts 삭제 시 정본).
import { DEFAULT_ERROR_REGISTRY } from "../registry";

export type ErrorCode = keyof typeof DEFAULT_ERROR_REGISTRY;
export const KNOWN_ERROR_CODES: ReadonlySet<string> = new Set(Object.keys(DEFAULT_ERROR_REGISTRY));
export const isKnownErrorCode = (code: string): code is ErrorCode => KNOWN_ERROR_CODES.has(code);
