// ============================================================================
// error/registry-context.tsx  — §4.4  ('use client')
// Read-only React context carrying the active ErrorRegistry for rare
// presentational lookups (e.g. a code→label map in a debug panel). Feature
// components read the normalized AppError / ResolvedAppError.policy instead.
// ============================================================================
"use client";
import { createContext, useContext } from "react";
import { DEFAULT_ERROR_REGISTRY, type ErrorRegistry } from "error-core/registry";

const RegistryContext = createContext<ErrorRegistry>(DEFAULT_ERROR_REGISTRY);
export const ErrorRegistryProvider = RegistryContext.Provider;
export const useErrorRegistry = (): ErrorRegistry => useContext(RegistryContext);
