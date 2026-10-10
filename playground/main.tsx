import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { CodeExecutor } from "react-exe";
import { scenarios, type Scenario } from "./scenarios";

type Mode = "both" | "sandbox" | "parent";

function ScenarioCard({ scenario, sandbox: initialSandbox }: { scenario: Scenario; sandbox: boolean }) {
  const [code, setCode] = useState(scenario.code);
  // Flipping these in place (no remount) exercises the iframe reload paths.
  const [sandbox, setSandbox] = useState(initialSandbox);
  const [tailwind, setTailwind] = useState(!!scenario.config?.enableTailwind);
  return (
    <section className="card" data-scenario={scenario.id} data-sandbox={String(sandbox)}>
      <h2>
        {scenario.title}
        <small>
          <button onClick={() => setSandbox(!sandbox)}>{sandbox ? "sandbox" : "parent"}</button>{" "}
          <button onClick={() => setTailwind(!tailwind)}>tailwind {tailwind ? "on" : "off"}</button>
        </small>
      </h2>
      {typeof code === "string" && (
        <textarea value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} />
      )}
      <div className="preview">
        <CodeExecutor code={code} config={{ ...scenario.config, sandbox, enableTailwind: tailwind }} />
      </div>
    </section>
  );
}

function App() {
  const params = new URLSearchParams(location.search);
  const [mode, setMode] = useState<Mode>((params.get("mode") as Mode) || "both");
  const only = params.get("only");
  const visible = scenarios.filter((s) => !only || only.split(",").includes(s.id));
  const modes = mode === "both" ? [true, false] : [mode === "sandbox"];

  return (
    <>
      <header>
        <h1>react-exe playground</h1>
        <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
          <option value="both">sandbox + parent</option>
          <option value="sandbox">sandbox only</option>
          <option value="parent">parent only</option>
        </select>
      </header>
      <main>
        {visible.flatMap((s) =>
          modes.map((sandbox) => (
            <ScenarioCard key={`${s.id}-${sandbox}`} scenario={s} sandbox={sandbox} />
          ))
        )}
      </main>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
