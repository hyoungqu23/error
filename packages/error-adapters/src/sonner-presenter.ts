// error/adapters/sonner-presenter.ts  — the ONLY file that imports the sonner SDK.
// (design §5 — Presenter sink) Client-only UX sink: turns a DomainError into a toast.
//
// Copy is resolved through resolveErrorMessage (host translator → co-located fallback →
// generic line), so the Presenter never renders a raw i18n key. RATE_LIMITED interpolates
// a `{seconds}` countdown from its public retryAfterMs detail (G2 / G6).
//
// Dedupe: the toast `id` is the error.code, so a storm of the same code collapses into a
// single, updating toast instead of stacking. Only "toast"/"alert" are meaningful here;
// the handleError pipeline already filters non-Presenter surfaces, but we defend anyway.
import { toast } from "sonner";
import type { Presenter } from "error-core/telemetry";
import { isDomainError, type DomainError } from "error-core/app-error";
import { resolveErrorMessage, type Translator } from "error-core/translator";

/**
 * Read the public Retry-After value (ms) off a RATE_LIMITED error without an `any` cast.
 * `error.details` on a generic DomainError is the full ErrorDetailsMap union (incl. null),
 * so `.retryAfterMs` is not reachable directly. The isDomainError(e, code) guard narrows
 * the WHOLE instance to DomainError<"RATE_LIMITED">, collapsing details to
 * `{ retryAfterMs?: number } | null` — strict + noUncheckedIndexedAccess clean.
 */
const retryAfterMsOf = (error: DomainError): number | undefined => {
  if (!isDomainError(error, "RATE_LIMITED")) return undefined;
  return error.details?.retryAfterMs;
};

export const createSonnerPresenter = (translator?: Translator | null): Presenter => ({
  present(error, action) {
    // Defensive: only toast/alert reach a user-facing toast surface.
    if (action !== "toast" && action !== "alert") return;

    const retryAfterMs = retryAfterMsOf(error);
    const vars =
      retryAfterMs !== undefined ? { seconds: Math.ceil(retryAfterMs / 1000) } : undefined;
    const message = resolveErrorMessage(error.userMessageKey, translator, vars);

    // Dedupe by code: one toast per code, updated in place on repeats.
    const options = { id: error.code } as const;
    if (action === "alert") toast.error(message, options);
    else toast(message, options);
  },
});
