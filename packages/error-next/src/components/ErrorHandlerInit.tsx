"use client";

// components/ErrorHandlerInit.tsx — mounted once in app/layout.tsx (§8.1).
// Seeds the client singleton sink with a per-request correlationId (rendered in by
// the root layout from the proxy-set cookie/header, §9 step 3) inside useEffect —
// never during render. The composition-root deps are assembled here from canonical
// core symbols: the active registry, a no-op client Reporter/Notifier, and an inline
// no-op Presenter (the real sonner presenter is wired by the host app, not the core).

import { useEffect } from "react";
import { initHandleError } from "error-core/handler";
import { getActiveErrorRegistry } from "error-core/active-registry";
import { noopReporter } from "error-core/adapters/composite";
import { noopNotifier } from "error-core/notifier";
import type { HandleErrorDeps } from "error-core/types";
import type { Presenter } from "error-core/telemetry";

const noopPresenter: Presenter = { present() {} };

const buildClientDeps = (): HandleErrorDeps => ({
  registry: getActiveErrorRegistry(),
  reporter: noopReporter,
  presenter: noopPresenter,
  notifier: noopNotifier,
});

export function ErrorHandlerInit({ correlationId }: { correlationId: string }) {
  useEffect(() => {
    initHandleError(buildClientDeps(), correlationId);
  }, [correlationId]);
  return null;
}
