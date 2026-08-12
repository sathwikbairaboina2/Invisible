import React, { useCallback, useEffect, useState } from 'react';

const STATE_LABEL = { ok: 'ok', missing: 'missing', error: 'error' };

/**
 * Shows every dependency and, for anything missing, the exact command that
 * fixes it.
 *
 * Nothing here mutates: each fix starts a container, downloads gigabytes, or
 * touches a personal corpus, and a settings window is not where any of that
 * should happen by accident. The command is selectable so it can be copied.
 */
export function SetupPanel() {
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    setBusy(true);
    try {
      setReport(await window.invisible.checkSetup());
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    run();
  }, [run]);

  return (
    <section>
      <h2>Setup</h2>

      {report === null ? (
        <p className="hint">Checking…</p>
      ) : (
        <>
          <p className="setup-summary" data-ok={report.ok}>
            {report.ok
              ? 'Ready. Everything the app needs is in place.'
              : 'Not ready. Fix the items below, then re-check.'}
          </p>

          {report.checks.map((check) => (
            <div className="setup-row" key={check.id}>
              <span className="pill" data-state={check.state}>
                {STATE_LABEL[check.state]}
              </span>
              <div>
                <span className="label">{check.label}</span>
                <span className="hint">{check.detail}</span>
                {check.fix ? <code className="fix">{check.fix}</code> : null}
              </div>
            </div>
          ))}
        </>
      )}

      <div className="actions">
        <button onClick={run} disabled={busy}>
          {busy ? 'Checking…' : 'Re-check'}
        </button>
      </div>
    </section>
  );
}
