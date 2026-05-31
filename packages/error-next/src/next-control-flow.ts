// error/next-control-flow.ts
// The single source of truth for "is this a framework control-flow interrupt?".
// Prefers Next's own `unstable_rethrow` (next@15.5 exports it from "next/navigation"),
// which covers redirect, notFound, and the experimental forbidden()/unauthorized()
// signals in one call. The digest-based predicates remain as a belt-and-suspenders
// fallback for environments where `unstable_rethrow` is a no-op.
import { unstable_rethrow } from "next/navigation";

const digestOf = (e: unknown): string | undefined =>
  typeof e === "object" &&
  e !== null &&
  "digest" in e &&
  typeof (e as { digest: unknown }).digest === "string"
    ? (e as { digest: string }).digest
    : undefined;

export const isRedirectError = (e: unknown): boolean =>
  digestOf(e)?.startsWith("NEXT_REDIRECT") ?? false;

export const isNotFoundError = (e: unknown): boolean => digestOf(e) === "NEXT_NOT_FOUND";

/** Covers experimental forbidden()/unauthorized() — they throw NEXT_HTTP_ERROR_FALLBACK;<status>. */
export const isHttpAccessFallbackError = (e: unknown): boolean =>
  digestOf(e)?.startsWith("NEXT_HTTP_ERROR_FALLBACK") ?? false;

export const isFrameworkControlFlow = (e: unknown): boolean =>
  isRedirectError(e) || isNotFoundError(e) || isHttpAccessFallbackError(e);

/**
 * Re-throw any framework control-flow signal untouched; otherwise return.
 * `unstable_rethrow` throws iff `e` is a framework signal and returns otherwise, so the
 * `try/catch` only re-surfaces a genuine interrupt; the predicate path is a fallback.
 */
export const rethrowControlFlow = (e: unknown): void => {
  try {
    unstable_rethrow(e); // throws iff `e` is a framework signal; returns otherwise
  } catch (rethrown) {
    throw rethrown;
  }
  if (isFrameworkControlFlow(e)) throw e; // belt-and-suspenders for the predicate path
};
