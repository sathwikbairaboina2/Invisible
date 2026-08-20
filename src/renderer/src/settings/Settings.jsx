import React, { useEffect, useState } from 'react';
import { SetupPanel } from './SetupPanel.jsx';
import { SessionPanel } from './SessionPanel.jsx';
import { CorpusPanel } from './CorpusPanel.jsx';
import './settings.css';

/**
 * Every field the operator may change, with the ones needing a restart marked.
 *
 * A number input that silently does nothing until relaunch is worse than no
 * input, so the distinction is shown rather than documented elsewhere.
 */
const SECTIONS = [
  {
    title: 'Answers',
    rows: [
      {
        path: 'agent.temperature',
        label: 'Temperature',
        hint: 'Higher wanders; 0.2 keeps answers factual.',
        step: 0.05,
      },
      {
        path: 'agent.numPredict',
        label: 'Max tokens',
        hint: 'Caps a runaway answer. The prompt asks for under 60 words.',
        step: 10,
      },
      {
        path: 'agent.historyTurns',
        label: 'Dialogue turns sent',
        hint: 'How much conversation the model sees, so follow-ups resolve.',
        step: 1,
      },
    ],
  },
  {
    title: 'Retrieval',
    rows: [
      {
        path: 'agent.qdrant.topK',
        label: 'Results considered',
        hint: 'How many chunks are fetched before filtering.',
        step: 1,
      },
      {
        path: 'agent.qdrant.scoreThreshold',
        label: 'Score threshold',
        hint: 'Below this, a chunk is noise. Raise it if answers pull in irrelevant history.',
        step: 0.01,
      },
    ],
  },
  {
    title: 'Overlay',
    rows: [
      {
        path: 'overlay.opacity',
        label: 'Opacity',
        hint: 'Whole-panel transparency. 1 is opaque; 0.6 keeps slides readable behind it.',
        step: 0.05,
      },
    ],
  },
  {
    title: 'Voice detection',
    rows: [
      {
        path: 'audio.vad.redemptionMs',
        label: 'End-of-speech wait',
        hint: 'Silence tolerated mid-sentence. Applies immediately (capture restarts).',
        step: 32,
      },
      {
        path: 'audio.vad.minSpeechMs',
        label: 'Minimum speech',
        hint: 'Shorter bursts are discarded as coughs. Applies immediately (capture restarts).',
        step: 32,
      },
    ],
  },
];

const SHORTCUTS = [
  ['Show / hide overlay', 'Ctrl+Shift+\\'],
  ['Click-through toggle', 'Ctrl+Shift+Enter'],
  ['Ask about the last question', 'Ctrl+Shift+Space'],
  ['Clear transcript', 'Ctrl+Shift+K'],
  ['Panic — hide and stop', 'Ctrl+Shift+X'],
  ['Move overlay', 'Ctrl+Shift+Arrows'],
  ['Settings', 'Ctrl+Shift+,'],
  ['Toggle interview / meeting mode', 'Ctrl+Shift+M'],
  ['Type a question', 'Ctrl+Shift+/'],
  ['Cycle answer style', 'Ctrl+Shift+.'],
  ['Export meeting notes', 'Ctrl+Shift+E'],
  ['Answer clipboard text', 'Ctrl+Shift+;'],
  ['Jump overlay to next corner', 'Ctrl+Shift+O'],
  ['Resume capture after panic', "Ctrl+Shift+'"],
];

const read = (object, path) => path.split('.').reduce((node, key) => node?.[key], object);

/** Turns "agent.qdrant.topK" plus a value into a nested patch object. */
const patchFor = (path, value) =>
  path
    .split('.')
    .reverse()
    .reduce((acc, key) => ({ [key]: acc }), value);

export function Settings() {
  const [settings, setSettings] = useState(null);
  const [note, setNote] = useState(null);

  useEffect(() => {
    window.invisible.settings.get().then(setSettings);
  }, []);

  if (!settings) return <div className="shell">Loading…</div>;

  async function commit(path, raw) {
    const value = Number(raw);
    if (!Number.isFinite(value)) return;

    const result = await window.invisible.settings.set(patchFor(path, value));
    if (result.ok) {
      setSettings(result.settings);
      setNote({ kind: 'saved', text: 'Saved' });
    } else {
      setNote({ kind: 'error', text: result.error });
    }
  }

  async function resetAll() {
    const result = await window.invisible.settings.reset();
    setSettings(result.settings);
    setNote({ kind: 'saved', text: 'Reset to defaults' });
  }

  return (
    <div className="shell">
      <h1>Settings</h1>
      <p className="subtitle">
        Stored in your user profile. Only the values you change are saved, so defaults keep
        improving underneath them.
      </p>

      {/* First, because on a fresh machine it is the only section that
          matters, and on a working machine it is one green line to scroll
          past. */}
      <SetupPanel />

      <SessionPanel />

      <CorpusPanel />

      {SECTIONS.map((section) => (
        <section key={section.title}>
          <h2>{section.title}</h2>
          {section.rows.map((row) => (
            <div className="row" key={row.path}>
              <div>
                <span className="label">{row.label}</span>
                <span className="hint">{row.hint}</span>
              </div>
              <input
                type="number"
                step={row.step}
                defaultValue={read(settings, row.path)}
                onBlur={(event) => commit(row.path, event.target.value)}
              />
            </div>
          ))}
        </section>
      ))}

      <section>
        <h2>Shortcuts</h2>
        {SHORTCUTS.map(([label, keys]) => (
          <div className="row" key={label}>
            <span className="label">{label}</span>
            <kbd>{keys}</kbd>
          </div>
        ))}
      </section>

      <div className="actions">
        <button onClick={resetAll}>Reset to defaults</button>
        {note ? <span className={`note ${note.kind}`}>{note.text}</span> : null}
      </div>
    </div>
  );
}
