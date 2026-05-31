// ============================================================================
// error/handler.ts  (client singleton)  — §8.1
// Module-slot singleton: initHandleError builds the handler once at startup and
// binds the active registry; handleError/setErrorUser are the re-exported sink.
// ============================================================================
import { createHandleError, type HandleErrorOptions } from "./handle-error";
import { setActiveErrorRegistry } from "./active-registry";
import type { HandleErrorDeps } from "./types";
import type { ResolvedAppError } from "./app-error";

let _handle: ((input: unknown, opts?: HandleErrorOptions) => ResolvedAppError) | null = null;

export const initHandleError = (deps: HandleErrorDeps, correlationId?: string): void => {
  setActiveErrorRegistry(deps.registry); // ← getters/isSerializedError now agree with deps.registry
  _handle = createHandleError(deps, { runtime: "client", correlationId, user: null });
  deps.reporter.setContext({ correlationId });
};

export const handleError = (input: unknown, opts?: HandleErrorOptions): ResolvedAppError => {
  if (!_handle) {
    // dev guard — initHandleError() must run once at startup (ErrorHandlerInit).
    throw new Error(
      "initHandleError() not called: mount <ErrorHandlerInit /> once in app/layout.tsx before using handleError().",
    );
  }
  return _handle(input, opts);
};

export const setErrorUser = (
  user: { id: string; role?: string } | null,
  deps: HandleErrorDeps,
): void => {
  deps.reporter.setUser(user);
};
