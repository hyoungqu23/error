// error/adapters/composite.ts  — GUARDED with a DEAD-MAN'S-SWITCH (design §5.3, RFC 모듈 맵).
// Telemetry must never throw into the app, BUT a silently-swallowed telemetry failure
// is invisible — so we count failures per sink and emit a RATE-LIMITED last-resort line
// to stderr (server) / console.error (client).
// (P6: P3e가 구 Reporter 기반 구현을 삭제한 뒤, 신 ReporterSink(capture/breadcrumb) 위에 재도입.)
import type { ReporterSink } from "../decision/types";

export interface ReporterHealth {
  readonly failures: ReadonlyMap<string, number>;
  /** Running total of swallowed failures across all sinks/ops (never reset). */
  readonly totalFailures: number;
  readonly lastFailureAt?: number;
}

const emitLastResort = (line: Record<string, unknown>): void => {
  const text = `[telemetry-dead-mans-switch] ${JSON.stringify(line)}\n`;
  const proc = (globalThis as { process?: { stderr?: { write(s: string): void } } }).process;
  if (proc?.stderr?.write) proc.stderr.write(text);
  else console.error(text);
};

export interface CompositeReporterOptions {
  /** Min ms between last-resort emissions (don't let the dead-man's-switch itself storm). default 5000 */
  alertThrottleMs?: number;
  now?: () => number;
}

/** A ReporterSink paired with a stable label used in failure accounting. */
export interface LabeledReporter {
  label: string;
  reporter: ReporterSink;
}

export interface GuardedCompositeReporter extends ReporterSink {
  /** Inspectable health — surface in a /health route or assert in tests. */
  health(): ReporterHealth;
}

export const guardedCompositeReporter = (
  sinks: ReadonlyArray<LabeledReporter>,
  options: CompositeReporterOptions = {},
): GuardedCompositeReporter => {
  const throttleMs = options.alertThrottleMs ?? 5000;
  const now = options.now ?? (() => Date.now());
  const failures = new Map<string, number>();
  let totalFailures = 0; // running total across all sinks/ops; never reset.
  let lastFailureAt: number | undefined;
  let lastAlertAt = 0;

  // guard는 fn을 실행하고 "마커 소비 원격 transport에 실제 전송됐는가"를 반환한다(Codex P1):
  // 오직 fn이 명시적 `true`를 반환할 때만 true. throw → 카운트/dead-man's-switch 후 false,
  // false(의도적 드롭/전송 실패/비-원격 sink) → false, undefined/void(legacy sink, 전송 주장 없음)
  // → false. 호출 측이 이 값을 OR로 composite capture 반환에 집계한다(어느 원격 sink든 true면
  // 전체 true — 아래 capture 주석 참조). breadcrumb처럼 반환값을 안 쓰는 fan-out에도 안전하다.
  const guard = (label: string, op: string, fn: () => void | boolean): boolean => {
    try {
      return fn() === true;
    } catch (cause) {
      const n = (failures.get(label) ?? 0) + 1;
      failures.set(label, n);
      totalFailures += 1;
      lastFailureAt = now();
      if (lastFailureAt - lastAlertAt >= throttleMs) {
        lastAlertAt = lastFailureAt;
        emitLastResort({
          sink: label,
          op,
          totalFailures: n,
          runningTotal: totalFailures,
          message: cause instanceof Error ? cause.message : String(cause),
          at: new Date(lastFailureAt).toISOString(),
        });
      }
      return false;
    }
  };

  return {
    // 캡처 반환 프로토콜 집계(OR — 원격 전송 도달 여부, Codex P1): "전송됨"은 오직 sink가
    // 명시적 `true`를 반환했을 때만이다. 어느 한 sink라도 true면 composite는 true를 반환한다 →
    // 파이프라인이 dedupe 마킹을 해 자동 캡처본을 드롭(이중 캡처 차단). 이는 불변식 "비-원격
    // sink(console/noop: false)는 원격 sink(Sentry: true)의 마킹을 깔아뭉개지 않는다"를 지킨다 —
    // '어느 sink든 false면 전체 false'(AND-부정) 집계였다면 레퍼런스 Sentry+console 배선에서
    // console의 false가 Sentry의 true를 무력화해 매 캡처마다 비마킹→이중 보고가 됐다(P0b 리뷰
    // blocker #1). 반대로 undefined(legacy void sink)를 "전송됨"으로 치면 void sink 하나만 끼어도
    // Sentry throttle-drop(false)을 깔아뭉개 마킹→자동 캡처본 드롭→스톰 시 0건이 부활했다 — 그래서
    // 이제 true만 전송으로 집계하고 void는 비전송으로 취급한다(Codex P1). 멀티 원격 sink 구성 시
    // 케이빗: 마커의 유일한 소비자는 Sentry(composeBeforeSend)이므로, true는 마커 소비자 전송에만
    // 의미가 있다 — Sentry가 아닌 다른 원격 transport가 true를 반환해도 그것이 곧 자동 캡처본
    // 드롭의 근거가 된다(드롭 주체는 Sentry beforeSend 한 곳).
    // throttle-drop 0건 결함은 여전히 닫힌다: 원격 sink(Sentry)가 단독으로 false를 반환하고 다른
    // 전송 sink가 없으면(또는 모두 false/void면) 어느 것도 전송되지 않아 composite는 false → 비마킹 →
    // 자동 캡처 안전망 생존. 가시성은 throw 카운트(health())가 OR 집계와 별도로 항상 유지한다.
    // forEach가 아닌 명시 루프로 모든 sink를 항상 호출(단락 평가로 sink를 건너뛰지 않도록).
    capture: (e, d, c) => {
      let anySent = false;
      for (const s of sinks) {
        const sent = guard(s.label, "capture", () => s.reporter.capture(e, d, c));
        if (sent) anySent = true;
      }
      return anySent;
    },
    breadcrumb: (e, d, c) =>
      sinks.forEach((s) => guard(s.label, "breadcrumb", () => s.reporter.breadcrumb(e, d, c))),
    health: () => ({ failures: new Map(failures), totalFailures, lastFailureAt }),
  };
};

/** "Optional" = compose this in when monitoring is disabled (e.g. in tests / local). */
export const noopReporter: ReporterSink = {
  // 캡처 반환 프로토콜: noop은 원격 관측 시스템에 아무것도 전송하지 않으므로 `false`를 반환한다
  // (가시성-안전). OR 집계에서 false는 무력(inert)이다 — 단독이면 composite가 false라 비마킹돼
  // 자동 캡처가 산다(noop만 끼면 마킹할 원격 전송이 없으므로 옳다). 같은 composite에 원격 sink가
  // 함께 있고 그것이 명시적 true를 반환하면 OR로 composite는 true가 되어 noop의 false가 그 마킹을
  // 깔아뭉개지 않는다.
  capture: () => false,
  breadcrumb() {},
};

/**
 * Legacy variadic composite (unlabeled). Kept for call sites that don't need health
 * accounting; prefer guardedCompositeReporter([{label,reporter}, …]) for production.
 */
const guardQuiet = (fn: () => void | boolean): boolean => {
  try {
    return fn() === true; // 전송됨은 오직 명시적 true(Codex P1) — undefined/false는 비전송.
  } catch {
    /* telemetry must never throw */
    return false;
  }
};

export const compositeReporter = (...r: ReporterSink[]): ReporterSink => ({
  // guardedCompositeReporter와 같은 OR 집계 의미론: 어느 한 sink라도 명시적 true를 반환(전송됨)했으면
  // true, 전부 throw/false/undefined(비-원격 sink·legacy void sink 포함)면 false(가시성 fail-open).
  // 비-원격 sink가 원격 sink의 마킹을 깔아뭉개지 않는다.
  capture: (e, d, c) => {
    let anySent = false;
    for (const x of r) {
      if (guardQuiet(() => x.capture(e, d, c))) anySent = true;
    }
    return anySent;
  },
  breadcrumb: (e, d, c) => r.forEach((x) => guardQuiet(() => x.breadcrumb(e, d, c))),
});
