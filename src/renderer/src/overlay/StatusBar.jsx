import React from 'react';

/**
 * Collapses every subsystem's state into one dot and one phrase.
 *
 * The operator glances at this; it must answer "can I trust the panel right
 * now" in a single fixation, not enumerate four services.
 *
 * @param {{status: object}} props
 */
export function StatusBar({ status }) {
  const { state, label } = describe(status);

  return (
    <div className="status">
      <span className="dot" data-state={state} />
      <span>{label}</span>
      <span className="meters">
        <span className="meter" title="microphone">
          <i style={{ width: `${meterWidth(status, 'user')}%` }} />
        </span>
        <span className="meter" title="system audio">
          <i style={{ width: `${meterWidth(status, 'remote')}%` }} />
        </span>
      </span>
    </div>
  );
}

function meterWidth(status, speaker) {
  if (status.speakerLevel !== speaker || typeof status.level !== 'number') return 0;
  return Math.min(100, Math.round(status.level * 100));
}

/** @returns {{state: 'idle'|'live'|'warn'|'error', label: string}} */
function describe(status) {
  if (status.stt === 'failed') return { state: 'error', label: 'transcription offline' };
  if (status.stt === 'starting') return { state: 'warn', label: 'loading model' };
  if (!status.capturing) return { state: 'idle', label: 'idle' };
  if (status.stt !== 'ready') return { state: 'warn', label: 'waiting for model' };
  if (status.llm === 'offline') return { state: 'error', label: 'no model' };
  if (status.llm === 'no-model') return { state: 'error', label: 'model not pulled' };

  const suffix = [];
  if (status.rag === 'offline' || status.rag === 'empty') suffix.push('no context');
  if (status.dropped > 0) suffix.push(`${status.dropped} dropped`);

  return {
    state: suffix.length > 0 ? 'warn' : 'live',
    label: suffix.length > 0 ? `listening · ${suffix.join(' · ')}` : 'listening',
  };
}
