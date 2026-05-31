// ============================================================================
// error/active-registry.ts  — THE BINDING. Single authority both paths read.
// ============================================================================
import { DEFAULT_ERROR_REGISTRY, type ErrorRegistry } from "./registry";
import { getRuntime } from "./runtime";

// Server scope. Imported lazily through a typed indirection so node:async_hooks
// never reaches the client bundle.
type AsyncLocalStorageLike<T> = {
  getStore(): T | undefined;
  run<R>(store: T, cb: () => R): R;
};

let _serverStore: AsyncLocalStorageLike<ErrorRegistry> | null = null;

const getServerStore = (): AsyncLocalStorageLike<ErrorRegistry> => {
  if (_serverStore) return _serverStore;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AsyncLocalStorage } = require("node:async_hooks") as typeof import("node:async_hooks");
  _serverStore = new AsyncLocalStorage<ErrorRegistry>();
  return _serverStore;
};

// Client scope — a singleton (one tab = one app = one registry), bound at init.
let _clientRegistry: ErrorRegistry = DEFAULT_ERROR_REGISTRY;

// G3: dev-only seam. `_substitutedRegistryExists` flips true the first time a
// NON-default registry is bound at a composition root (client set or server run).
// If a getter then reads the registry with NO active store bound, the resolution
// silently falls back to DEFAULT — a likely composition-root wiring bug. Warn ONCE.
let _substitutedRegistryExists = false;
let _missingScopeWarned = false;

const isProd = (): boolean => process.env.NODE_ENV === "production";

const warnMissingScopeOnce = (): void => {
  if (isProd() || _missingScopeWarned || !_substitutedRegistryExists) return;
  _missingScopeWarned = true;
  // eslint-disable-next-line no-console
  console.warn(
    "[error] active registry read with NO scope bound, but a substituted registry " +
      "was registered at the composition root. Falling back to DEFAULT_ERROR_REGISTRY — " +
      "wrap server work in runWithErrorRegistry(deps.registry, …) (or call " +
      "setActiveErrorRegistry on the client) so the substituted catalog governs this read.",
  );
};

/**
 * Read the registry in force for the current execution. Never returns undefined.
 * - Server: the per-request store if inside runWithErrorRegistry, else DEFAULT.
 * - Client: the singleton bound at initHandleError, else DEFAULT.
 */
export const getActiveErrorRegistry = (): ErrorRegistry => {
  if (getRuntime() === "server") {
    const store = getServerStore().getStore();
    if (store === undefined) {
      warnMissingScopeOnce();
      return DEFAULT_ERROR_REGISTRY;
    }
    return store;
  }
  if (_clientRegistry === DEFAULT_ERROR_REGISTRY) warnMissingScopeOnce();
  return _clientRegistry;
};

/**
 * Client composition-root binding. Call once inside initHandleError(deps) with
 * deps.registry. Idempotent; last write wins.
 */
export const setActiveErrorRegistry = (registry: ErrorRegistry): void => {
  if (registry !== DEFAULT_ERROR_REGISTRY) _substitutedRegistryExists = true; // G3
  if (getRuntime() !== "server") {
    _clientRegistry = registry;
    return;
  }
  // On the server a bare set would leak across requests; force the scoped API.
  throw new Error(
    "setActiveErrorRegistry() is client-only. On the server, wrap the request " +
      "in runWithErrorRegistry(deps.registry, () => …) so the registry is scoped " +
      "per request (no cross-request leak).",
  );
};

/**
 * Server composition-root binding. Run the per-request work (RSC render, the
 * Server Action body, the Route Handler) inside this so getActiveErrorRegistry()
 * and the AppError getters resolve against deps.registry for THIS request only.
 */
export const runWithErrorRegistry = <R>(registry: ErrorRegistry, work: () => R): R => {
  if (registry !== DEFAULT_ERROR_REGISTRY) _substitutedRegistryExists = true; // G3
  return getServerStore().run(registry, work);
};
