// error/adapters/console-reporter.ts — structured server/dev sink (no SDK).
// (design §5.3)
//
// NOTE (module-map adaptation): the design imported `toInternalSerialized` from a
// `./serialize` module. The canonical module map's `serialize-client.ts` only exports
// the CLIENT-bound serializer (which drops `message` + gates `details`). The internal
// server-log line must KEEP `message` and ungated `details`, so the internal-serialized
// shape is built inline here directly off the DomainError instead of importing a
// non-existent `toInternalSerialized`.
import type { Reporter } from "../telemetry";
import type { DomainError, SerializedError } from "../app-error";

/** Internal / server-log DTO: KEEPS `message` and ungated `details`. Never reaches a browser. */
const toInternalSerialized = (error: DomainError): SerializedError => ({
  code: error.code,
  message: error.message,
  details: error.details,
  correlationId: error.correlationId,
});

export const createConsoleReporter = (): Reporter => ({
  report(error, level, ctx) {
    const line = {
      tag: "[error]",
      level,
      ...toInternalSerialized(error), // keeps message + ungated details (server log)
      route: ctx.route,
      runtime: ctx.runtime,
    };
    if (level === "fatal" || level === "error") console.error(line);
    else if (level === "warning") console.warn(line);
    else console.info(line);
  },
  // T1 impact breadcrumb: a low-noise debug line, NOT a re-capture. Keyed by
  // correlationId so the user-visible impact stitches to the captured error.
  breadcrumb(error, surface, ctx) {
    console.debug({
      tag: "[error.presented]",
      code: error.code,
      surface,
      correlationId: ctx.correlationId,
      route: ctx.route,
      runtime: ctx.runtime,
    });
  },
  setUser() {}, // console reporter is stateless
  setContext() {},
});
