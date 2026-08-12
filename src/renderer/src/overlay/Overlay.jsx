import React from 'react';
import { useAgent } from '../useAgent.js';

export function Overlay() {
  const { status, turn, answer, transcript, error } = useAgent();

  const label = !status.capturing
    ? 'idle'
    : status.stt === 'starting'
      ? 'loading model…'
      : status.stt === 'failed'
        ? 'transcription offline'
        : status.stt !== 'ready'
          ? 'waiting for model'
          : status.llm === 'offline'
            ? 'listening · no LLM'
            : 'listening';

  return (
    <div id="root-layout">
      <div>
        {label}
        {status.dropped > 0 ? ` · ${status.dropped} dropped` : ''}
      </div>
      <div>
        {answer}
        {turn.streaming ? '▌' : ''}
      </div>
      <div>
        {transcript.map((line) => (
          <div key={line.key}>
            {line.speaker === 'user' ? 'you: ' : 'them: '}
            {line.text}
          </div>
        ))}
      </div>
      {error ? <div>{`[${error.scope}] ${error.message}`}</div> : null}
    </div>
  );
}
