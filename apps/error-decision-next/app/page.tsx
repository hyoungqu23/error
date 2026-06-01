import { demoScenarios, translate } from "error-decision-system/demo";
import { ErrorSurface } from "error-decision-system/react";
import { LiveForm } from "./live-form";

export default async function Page() {
  const scenarios = await demoScenarios();

  return (
    <main>
      <section className="hero">
        <p className="eyebrow">Next.js 16.2.6 + TypeScript</p>
        <h1>Error Decision System</h1>
        <p>
          Feature code가 operation과 error code만 선언했을 때, 시스템이 사용자 표현과 telemetry 실행을
          어떻게 결정하는지 추적하는 데모입니다.
        </p>
      </section>

      <section className="summary" aria-label="architecture summary">
        <div>
          <strong>DX Layer</strong>
          <span>developer writes operation + fail/appError</span>
        </div>
        <div>
          <strong>Inner Architecture</strong>
          <span>typed catalog + boundary occurrence {"->"} ErrorDecision</span>
        </div>
        <div>
          <strong>Executors</strong>
          <span>disclosure-safe UI + sampled telemetry</span>
        </div>
      </section>

      <LiveForm />

      <section className="grid">
        {scenarios.map((scenario) => (
          <article className="scenario" key={scenario.label}>
            <header>
              <div>
                <h2>{scenario.label}</h2>
                <p>{scenario.situation}</p>
              </div>
              <span className={scenario.result.ok ? "badge success" : "badge failure"}>
                {scenario.result.ok ? "success" : "decision"}
              </span>
            </header>

            <section className="trace">
              <div>
                <h3>Developer code</h3>
                <pre>{scenario.developerCode}</pre>
              </div>
              <div>
                <h3>User outcome</h3>
                <p>{scenario.expectedUser}</p>
              </div>
              <div>
                <h3>Telemetry outcome</h3>
                <p>{scenario.expectedTelemetry}</p>
              </div>
            </section>

            {scenario.result.ok ? (
              <pre>{JSON.stringify(scenario.result.data, null, 2)}</pre>
            ) : (
              <>
                <ErrorSurface
                  decision={scenario.result.decision}
                  translate={translate}
                  details={scenario.result.payload.details}
                />
                <dl>
                  <div>
                    <dt>operation</dt>
                    <dd>{scenario.result.occurrence.operation}</dd>
                  </div>
                  <div>
                    <dt>surface</dt>
                    <dd>{scenario.result.decision.user.surface}</dd>
                  </div>
                  <div>
                    <dt>disclosure</dt>
                    <dd>{scenario.result.decision.user.disclosure}</dd>
                  </div>
                  <div>
                    <dt>message key</dt>
                    <dd>{scenario.result.decision.user.messageKey}</dd>
                  </div>
                  <div>
                    <dt>capture</dt>
                    <dd>{String(scenario.result.decision.telemetry.capture)}</dd>
                  </div>
                  <div>
                    <dt>level</dt>
                    <dd>{scenario.result.decision.telemetry.level}</dd>
                  </div>
                  <div>
                    <dt>alert</dt>
                    <dd>{String(scenario.result.decision.telemetry.alert)}</dd>
                  </div>
                  <div>
                    <dt>sample</dt>
                    <dd>{scenario.result.decision.telemetry.sampleRate ?? "n/a"}</dd>
                  </div>
                </dl>
                <section className="telemetry-events">
                  <h3>Telemetry sink events</h3>
                  {scenario.telemetryEvents.length ? (
                    <pre>{JSON.stringify(scenario.telemetryEvents, null, 2)}</pre>
                  ) : (
                    <p>No capture, breadcrumb, or alert event executed.</p>
                  )}
                </section>
              </>
            )}
          </article>
        ))}
      </section>
    </main>
  );
}
