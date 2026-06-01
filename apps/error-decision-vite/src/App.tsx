import { useEffect, useState } from "react";
import { demoScenarios, translate } from "error-decision-system/demo";
import { ErrorSurface } from "error-decision-system/react";
import type { DecisionResult } from "error-decision-system";

interface Scenario {
  label: string;
  result: DecisionResult<unknown>;
}

export function App() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);

  useEffect(() => {
    void demoScenarios().then(setScenarios);
  }, []);

  return (
    <main>
      <section className="hero">
        <p className="eyebrow">Vite + React + TypeScript</p>
        <h1>Error Decision System</h1>
        <p>
          같은 inner decision engine과 DX facade를 Next 없이도 사용할 수 있음을 보여주는 순수 React 데모입니다.
        </p>
      </section>

      <section className="architecture">
        <div>
          <strong>Feature code</strong>
          <span>operation + fail/appError</span>
        </div>
        <div>
          <strong>Decision engine</strong>
          <span>semantics + occurrence + criticality</span>
        </div>
        <div>
          <strong>React UI</strong>
          <span>ErrorSurface executes user decision</span>
        </div>
      </section>

      <section className="scenario-list">
        {scenarios.map((scenario) => (
          <article className="scenario" key={scenario.label}>
            <header>
              <h2>{scenario.label}</h2>
              <span className={scenario.result.ok ? "badge success" : "badge decision"}>
                {scenario.result.ok ? "success" : "decision"}
              </span>
            </header>

            {scenario.result.ok ? (
              <pre>{JSON.stringify(scenario.result.data, null, 2)}</pre>
            ) : (
              <div className="decision-grid">
                <ErrorSurface decision={scenario.result.decision} translate={translate} />
                <table>
                  <tbody>
                    <tr>
                      <th>operation</th>
                      <td>{scenario.result.occurrence.operation}</td>
                    </tr>
                    <tr>
                      <th>surface</th>
                      <td>{scenario.result.decision.user.surface}</td>
                    </tr>
                    <tr>
                      <th>action</th>
                      <td>{scenario.result.decision.user.action}</td>
                    </tr>
                    <tr>
                      <th>capture</th>
                      <td>{String(scenario.result.decision.telemetry.capture)}</td>
                    </tr>
                    <tr>
                      <th>sample</th>
                      <td>{scenario.result.decision.telemetry.sampleRate ?? "n/a"}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </article>
        ))}
      </section>
    </main>
  );
}
