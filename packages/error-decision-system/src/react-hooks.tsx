"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import type { DecisionResult, DecisionSystem, ErrorDecision, OccurrenceContext } from "./index";
import { extractFieldErrors } from "./react";

const DecisionSystemContext = createContext<DecisionSystem | null>(null);

/**
 * Provides the decision system to client hooks that resolve raw errors (`useErrorDecision`).
 * `useFormAction`/`useDecisionQuery` do NOT need it — their actions already carry the system.
 */
export function DecisionSystemProvider({
  system,
  children,
}: {
  system: DecisionSystem;
  children: ReactNode;
}) {
  return <DecisionSystemContext.Provider value={system}>{children}</DecisionSystemContext.Provider>;
}

export function useDecisionSystem(): DecisionSystem {
  const system = useContext(DecisionSystemContext);
  if (!system) {
    throw new Error("[error-decision-system] useDecisionSystem must be used inside a <DecisionSystemProvider>.");
  }
  return system;
}

/**
 * Resolves a raw client-side error (e.g. caught in an error boundary or event handler) into an
 * ErrorDecision via the provided occurrence. Requires a <DecisionSystemProvider> ancestor.
 */
export function useErrorDecision(error: unknown, occurrence: OccurrenceContext): ErrorDecision | null {
  const system = useDecisionSystem();
  return useMemo(
    () => (error == null ? null : system.finalizeUnknown(error, occurrence, { runtime: "client" }).decision),
    [error, occurrence, system],
  );
}

/**
 * Executes a `redirect` decision: when the decision's surface is "redirect", navigates to its
 * target. Keeps router/navigation out of the RSC-safe ErrorSurface.
 */
export function useDecisionRedirect(
  decision: ErrorDecision | null | undefined,
  navigate: (target: string) => void,
): void {
  const target = decision?.user.surface === "redirect" ? decision.user.target : undefined;
  useEffect(() => {
    if (target) navigate(target);
  }, [target, navigate]);
}

interface DecisionState<T> {
  data: T | null;
  errorDecision: ErrorDecision | null;
  payload: unknown;
}

const splitResult = <T,>(result: DecisionResult<T>): DecisionState<T> =>
  result.ok
    ? { data: result.data, errorDecision: null, payload: null }
    : { data: null, errorDecision: result.decision, payload: result.payload };

/**
 * Drives a `defineFormAction`/`defineServerAction` wrapper. No provider needed: the action
 * already carries the resolved decision. UI reads `errorDecision`, never `error.code`.
 */
export function useFormAction<I, O>(action: (input: I) => Promise<DecisionResult<O>>) {
  const [state, setState] = useState<DecisionState<O>>({ data: null, errorDecision: null, payload: null });
  const [isPending, startTransition] = useTransition();

  const submit = useCallback(
    (input: I) =>
      new Promise<DecisionResult<O>>((resolve) => {
        startTransition(() => {
          void action(input).then((result) => {
            setState(splitResult(result));
            resolve(result);
          });
        });
      }),
    [action],
  );

  const reset = useCallback(() => setState({ data: null, errorDecision: null, payload: null }), []);

  // Reads allowlisted fieldErrors off the last failure payload, so a form can wire field-level
  // messages without ever touching error.code.
  const fieldError = useCallback(
    (name: string): string[] | undefined =>
      extractFieldErrors((state.payload as { details?: unknown } | null)?.details)?.[name],
    [state.payload],
  );

  return { ...state, isPending, submit, reset, fieldError };
}

/**
 * Drives a `defineQuery` wrapper. A thrown error becomes an `errorDecision`, never a page
 * crash — the consumer renders `<ErrorSurface decision={errorDecision} />`.
 */
export function useDecisionQuery<I, O>(query: (input: I) => Promise<DecisionResult<O>>, input: I) {
  const [state, setState] = useState<DecisionState<O>>({ data: null, errorDecision: null, payload: null });
  const [isLoading, setIsLoading] = useState(true);
  const queryRef = useRef(query);
  queryRef.current = query;
  const inputKey = JSON.stringify(input);

  const run = useCallback(() => {
    let active = true;
    setIsLoading(true);
    void queryRef.current(input).then((result) => {
      if (!active) return;
      setState(splitResult(result));
      setIsLoading(false);
    });
    return () => {
      active = false;
    };
    // input is tracked via inputKey to avoid identity churn on object inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputKey]);

  useEffect(run, [run]);

  return { ...state, isLoading, refetch: run };
}
