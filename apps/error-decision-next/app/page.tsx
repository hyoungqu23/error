import { demoScenarios, translate } from "error-decision-system/demo";
import { ErrorSurface } from "error-decision-system/react";

export default async function Page() {
  const scenarios = await demoScenarios();

  return (
    <main>
      <section className="hero">
        <p className="eyebrow">Next.js 16.2.6 + TypeScript</p>
        <h1>Error Decision System</h1>
        <p>
          Feature code는 operation과 error code만 선언하고, inner decision engine이 사용자 표현과
          telemetry를 결정하는 데모입니다.
        </p>
      </section>

      <section className="summary" aria-label="architecture summary">
        <div>
          <strong>DX Layer</strong>
          <span>defineFormAction, defineQuery, fail, appError</span>
        </div>
        <div>
          <strong>Inner Architecture</strong>
          <span>semantics + occurrence + criticality {"->"} ErrorDecision</span>
        </div>
        <div>
          <strong>Executors</strong>
          <span>ErrorSurface + telemetry decision</span>
        </div>
      </section>

      <section className="grid">
        {scenarios.map((scenario) => (
          <article className="scenario" key={scenario.label}>
            <header>
              <h2>{scenario.label}</h2>
              <span className={scenario.result.ok ? "badge success" : "badge failure"}>
                {scenario.result.ok ? "success" : "decision"}
              </span>
            </header>

            {scenario.result.ok ? (
              <pre>{JSON.stringify(scenario.result.data, null, 2)}</pre>
            ) : (
              <>
                <ErrorSurface decision={scenario.result.decision} translate={translate} />
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
                    <dt>capture</dt>
                    <dd>{String(scenario.result.decision.telemetry.capture)}</dd>
                  </div>
                  <div>
                    <dt>alert</dt>
                    <dd>{String(scenario.result.decision.telemetry.alert)}</dd>
                  </div>
                </dl>
              </>
            )}
          </article>
        ))}
      </section>
    </main>
  );
}
