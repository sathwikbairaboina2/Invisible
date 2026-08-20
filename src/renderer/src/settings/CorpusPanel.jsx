import React, { useEffect, useState } from 'react';

/**
 * Corpus status plus a one-click re-index. The directory itself is shown but
 * not editable here — it is deliberately outside the settings allow-list, and
 * is chosen with the INVISIBLE_CORPUS_DIR environment variable instead.
 */
export function CorpusPanel() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  async function refresh() {
    setStatus(await window.invisible.corpus.status());
  }

  useEffect(() => {
    refresh();
  }, []);

  if (!status) return null;

  async function reindex() {
    setBusy(true);
    setNote(null);
    const result = await window.invisible.corpus.ingest();
    setBusy(false);
    if (result.ok) {
      setNote({
        kind: 'saved',
        text: `Indexed ${result.chunks} chunks from ${result.files} files`,
      });
      refresh();
    } else {
      setNote({ kind: 'error', text: result.error });
    }
  }

  return (
    <section>
      <h2>Knowledge</h2>
      <div className="row">
        <div>
          <span className="label">Corpus directory</span>
          <span className="hint">
            Markdown notes — résumé, project stories. Override with INVISIBLE_CORPUS_DIR.
          </span>
        </div>
        <code className="corpus-dir">{status.dir}</code>
      </div>
      <div className="row">
        <div>
          <span className="label">Indexed</span>
          <span className="hint">
            {status.ok
              ? 'Chunks currently retrievable during answers.'
              : `Qdrant unreachable: ${status.error ?? 'is the container running?'}`}
          </span>
        </div>
        <span className="label">{status.ok ? `${status.points} chunks` : '—'}</span>
      </div>
      <div className="actions">
        <button onClick={reindex} disabled={busy || !status.ok}>
          {busy ? 'Indexing…' : 'Re-index corpus'}
        </button>
        {note ? <span className={`note ${note.kind}`}>{note.text}</span> : null}
      </div>
    </section>
  );
}
