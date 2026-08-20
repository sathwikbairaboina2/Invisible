import React from 'react';
import { useAgent } from '../useAgent.js';
import { StatusBar } from './StatusBar.jsx';
import { AskInput } from './AskInput.jsx';
import { Answer } from './Answer.jsx';
import { Transcript } from './Transcript.jsx';
import './overlay.css';

export function Overlay() {
  const { status, turn, answer, followup, transcript, error } = useAgent();

  return (
    <div className={status.interactive ? 'panel interactive' : 'panel'}>
      <StatusBar status={status} />
      <AskInput />
      <Answer answer={answer} streaming={turn.streaming} aborted={turn.aborted} />
      {followup ? <div className="followup">next: {followup}</div> : null}
      <Transcript lines={transcript} />
      {error ? <div className="error">{`${error.scope}: ${error.message}`}</div> : null}
    </div>
  );
}
