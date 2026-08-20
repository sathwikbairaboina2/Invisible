import React, { useEffect, useState } from 'react';

const INTERVIEW_FIELDS = [
  ['company', 'Company', 'input'],
  ['role', 'Role', 'input'],
  ['jobDescription', 'Job description', 'textarea'],
];

const MEETING_FIELDS = [
  ['title', 'Meeting title', 'input'],
  ['attendees', 'Attendees', 'input'],
  ['agenda', 'Agenda', 'textarea'],
];

const EMPTY_PROFILE = {
  company: '', role: '', jobDescription: '', title: '', attendees: '', agenda: '',
};

/**
 * Mode picker plus the profile for the next meeting. Saves on blur like the
 * numeric rows below it; the mode select saves on change.
 */
export function SessionPanel() {
  const [session, setSession] = useState(null);
  const [note, setNote] = useState(null);

  useEffect(() => {
    window.invisible.session.get().then(setSession);
  }, []);

  if (!session) return null;

  async function commit(patch) {
    const result = await window.invisible.session.set(patch);
    if (result.ok) {
      setSession(result.session);
      setNote({ kind: 'saved', text: 'Saved' });
    } else {
      setNote({ kind: 'error', text: result.error });
    }
  }

  const fields = session.mode === 'interview' ? INTERVIEW_FIELDS : MEETING_FIELDS;

  return (
    <section>
      <h2>Session</h2>
      <div className="row">
        <div>
          <span className="label">Mode</span>
          <span className="hint">Also togglable mid-meeting with Ctrl+Shift+M.</span>
        </div>
        <select value={session.mode} onChange={(event) => commit({ mode: event.target.value })}>
          <option value="interview">Interview</option>
          <option value="meeting">Meeting</option>
        </select>
      </div>

      {fields.map(([key, label, kind]) => (
        // key on the row: switching mode swaps the field set, and React must
        // not reuse a defaultValue across different fields.
        <div className={kind === 'textarea' ? 'row stacked' : 'row'} key={key}>
          <span className="label">{label}</span>
          {kind === 'textarea' ? (
            <textarea
              rows={4}
              defaultValue={session.profile[key]}
              onBlur={(event) => commit({ profile: { [key]: event.target.value } })}
            />
          ) : (
            <input
              type="text"
              defaultValue={session.profile[key]}
              onBlur={(event) => commit({ profile: { [key]: event.target.value } })}
            />
          )}
        </div>
      ))}

      <div className="actions">
        <button onClick={() => commit({ profile: EMPTY_PROFILE })}>Clear profile</button>
        {note ? <span className={`note ${note.kind}`}>{note.text}</span> : null}
      </div>
    </section>
  );
}
