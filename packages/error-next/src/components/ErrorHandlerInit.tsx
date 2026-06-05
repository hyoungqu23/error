"use client";

// components/ErrorHandlerInit.tsx — mounted once in app/layout.tsx (§8.1).
// Seeds the client singleton sink with a per-request correlationId (rendered in by the root
// layout from the proxy-set cookie/header, §9 step 3) inside useEffect — never during render.
// The shared baseline DecisionSystem (errorSystem) owns all policy; the client sinks are inline
// no-ops (the real sonner reporter / pager are wired by the host app — P6/P8, via an optional
// system/sinks prop). Presentation is the UI's job — there is no Presenter (decision model).

import { useEffect } from "react";
import { initHandleError } from "error-core/handler";
import { noopReporter, type HandleErrorDeps, type NotifierSink } from "error-core";
import { clientErrorSystem } from "../error-system";

const noopNotifier: NotifierSink = { alert() {} };

const buildClientDeps = (): HandleErrorDeps => ({
  // 클라 fallback은 UNKNOWN_CLIENT_ERROR — 브라우저 unknown 예외를 서버 fault로 오분류하지 않는다.
  system: clientErrorSystem,
  reporter: noopReporter,
  notifier: noopNotifier,
});

export function ErrorHandlerInit({ correlationId }: { correlationId: string }) {
  useEffect(() => {
    initHandleError(buildClientDeps(), { correlationId });
  }, [correlationId]);
  return null;
}
