// ============================================================================
// error/field-errors.ts — G12 (query-track VALIDATION inline branch helper).
// Pulls the per-field validation map off a VALIDATION DomainError so a form can
// render inline field errors WITHOUT re-deriving the shape at every call site.
// Returns null for any other code (or a non-DomainError), so callers can branch
// on `fieldErrorsFromError(err) ?? <generic>` cleanly.
// ============================================================================
import { isDomainError } from "./app-error";

/**
 * Returns `error.details.fieldErrors` (Record<string, string[]>) when the error is
 * a VALIDATION DomainError, else null. The VALIDATION details schema guarantees the
 * `fieldErrors` shape, so the narrow is total — no cast leaks out.
 */
export const fieldErrorsFromError = (
  error: unknown,
): Record<string, string[]> | null => {
  if (!isDomainError(error, "VALIDATION")) return null;
  return error.details.fieldErrors;
};
