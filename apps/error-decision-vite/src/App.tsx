import { useEffect, useState } from "react";
import { demoScenarios, loginAction, productQuery, translate } from "error-decision-system/demo";
import { ErrorSurface } from "error-decision-system/react";
import { useDecisionQuery, useFormAction } from "error-decision-system/react-hooks";
import type { DemoScenario } from "error-decision-system/demo";

function LiveForm() {
  const form = useFormAction(loginAction);
  const product = useDecisionQuery(productQuery, { id: "missing" });
  const [email, setEmail] = useState("");
  const emailErrors = form.fieldError("email");

  return (
    <section className="live">
      <h2>Live hooks</h2>
      <div className="live-grid">
        <div>
          <h3>useFormAction(loginAction)</h3>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void form.submit({ email });
            }}
          >
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="이메일 입력 (@ 유무로 분기)"
              aria-label="email"
            />
            <button type="submit" disabled={form.isPending}>
              {form.isPending ? "확인 중…" : "로그인"}
            </button>
          </form>
          {emailErrors ? (
            <ul className="eds-field-errors">
              {emailErrors.map((message, index) => (
                <li key={index}>{message}</li>
              ))}
            </ul>
          ) : null}
          <ErrorSurface decision={form.errorDecision} translate={translate} />
        </div>
        <div>
          <h3>useDecisionQuery(productQuery, {"{ id: 'missing' }"})</h3>
          {product.isLoading ? <p>불러오는 중…</p> : null}
          <ErrorSurface decision={product.errorDecision} translate={translate} />
          {product.data ? <pre>{JSON.stringify(product.data, null, 2)}</pre> : null}
        </div>
      </div>
    </section>
  );
}

export function App() {
  const [scenarios, setScenarios] = useState<DemoScenario[]>([]);

  useEffect(() => {
    void demoScenarios().then(setScenarios);
  }, []);

  return (
    <main>
      <section className="hero">
        <p className="eyebrow">Vite + React + TypeScript</p>
        <h1>Error Decision System</h1>
        <p>
          상황별 feature code가 ErrorDecision으로 바뀌고, 사용자 표현과 telemetry sink로 어떻게 실행되는지
          확인하는 데모입니다.
        </p>
      </section>

      <section className="architecture">
        <div>
          <strong>Feature code</strong>
          <span>operation + fail/appError만 작성</span>
        </div>
        <div>
          <strong>Decision engine</strong>
          <span>typed catalog + boundary occurrence</span>
        </div>
        <div>
          <strong>React UI</strong>
          <span>disclosure-safe message execution</span>
        </div>
      </section>

      <LiveForm />

      <section className="scenario-list">
        {scenarios.map((scenario) => (
          <article className="scenario" key={scenario.label}>
            <header>
              <div>
                <h2>{scenario.label}</h2>
                <p>{scenario.situation}</p>
              </div>
              <span className={scenario.result.ok ? "badge success" : "badge decision"}>
                {scenario.result.ok ? "success" : "decision"}
              </span>
            </header>

            <div className="trace-grid">
              <section className="trace-panel">
                <h3>Developer code</h3>
                <pre>{scenario.developerCode}</pre>
              </section>

              <section className="trace-panel">
                <h3>User outcome</h3>
                <p>{scenario.expectedUser}</p>
              </section>

              <section className="trace-panel">
                <h3>Telemetry outcome</h3>
                <p>{scenario.expectedTelemetry}</p>
              </section>
            </div>

            {scenario.result.ok ? (
              <section className="trace-panel">
                <h3>Success payload</h3>
                <pre>{JSON.stringify(scenario.result.data, null, 2)}</pre>
              </section>
            ) : (
              <div className="decision-grid">
                <section>
                  <h3>User presentation</h3>
                  <ErrorSurface
                    decision={scenario.result.decision}
                    translate={translate}
                    details={scenario.result.payload.details}
                  />
                </section>
                <table>
                  <caption>Resolved decision</caption>
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
                      <th>disclosure</th>
                      <td>{scenario.result.decision.user.disclosure}</td>
                    </tr>
                    <tr>
                      <th>message key</th>
                      <td>{scenario.result.decision.user.messageKey}</td>
                    </tr>
                    <tr>
                      <th>capture</th>
                      <td>{String(scenario.result.decision.telemetry.capture)}</td>
                    </tr>
                    <tr>
                      <th>level</th>
                      <td>{scenario.result.decision.telemetry.level}</td>
                    </tr>
                    <tr>
                      <th>sample</th>
                      <td>{scenario.result.decision.telemetry.sampleRate ?? "n/a"}</td>
                    </tr>
                  </tbody>
                </table>
                <section className="trace-panel telemetry-panel">
                  <h3>Telemetry sink events</h3>
                  {scenario.telemetryEvents.length ? (
                    <pre>{JSON.stringify(scenario.telemetryEvents, null, 2)}</pre>
                  ) : (
                    <p>No capture, breadcrumb, or alert event executed.</p>
                  )}
                </section>
              </div>
            )}
          </article>
        ))}
      </section>
    </main>
  );
}
