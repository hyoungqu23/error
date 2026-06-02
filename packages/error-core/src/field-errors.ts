// error/field-errors.ts — VALIDATION 에러의 per-field 맵 추출(구 DomainError·신 AppError 공통).
import { isAppError } from "./decision/app-error";

export const fieldErrorsFromError = (
  error: unknown,
): Record<string, string[]> | null => {
  if (!isAppError(error) || error.code !== "VALIDATION") return null;
  const fe = (error.details as { fieldErrors?: Record<string, string[]> } | null | undefined)?.fieldErrors;
  return fe ?? null;
};
