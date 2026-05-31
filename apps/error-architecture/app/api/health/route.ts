// app/api/health/route.ts — G10 liveness/telemetry-health probe.
// guarded composite reporter(error-core)는 sink 실패를 삼켜 텔레메트리가 앱으로 throw되지
// 않게 하지만, 조용히 망가진 Sentry/console sink는 보이지 않는다. 이 라우트가 그걸 드러낸다:
// serverReporter.health()를 읽어 삼켜진 실패가 임계치를 넘으면 503을 반환 → 외부 uptime
// 모니터가 on-call을 호출(배선된 dead-man's-switch 에스컬레이션).
import { serverReporter } from "error-next/server";

export const dynamic = "force-dynamic"; // health 판정은 절대 캐시하지 않음
export const runtime = "nodejs"; // serverReporter는 server-only 어댑터를 끌어옴

const FAILURE_THRESHOLD = 5;

const totalFailures = (failures: ReadonlyMap<string, number>): number => {
  let total = 0;
  for (const n of failures.values()) total += n;
  return total;
};

export async function GET(): Promise<Response> {
  const health = serverReporter.health();
  const failures = totalFailures(health.failures);
  const healthy = failures < FAILURE_THRESHOLD;

  const body = {
    status: healthy ? "ok" : "degraded",
    telemetry: {
      failures,
      threshold: FAILURE_THRESHOLD,
      ...(health.lastFailureAt !== undefined
        ? { lastFailureAt: new Date(health.lastFailureAt).toISOString() }
        : {}),
      bySink: Object.fromEntries(health.failures),
    },
  };

  return Response.json(body, { status: healthy ? 200 : 503 });
}
