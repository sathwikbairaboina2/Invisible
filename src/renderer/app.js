'use strict';

(function () {
  const api = window.invisible;

  const el = {
    body: document.body,
    dot: document.getElementById('dot'),
    statusText: document.getElementById('statusText'),
    meterUser: document.getElementById('meterUser'),
    meterRemote: document.getElementById('meterRemote'),
    answer: document.getElementById('answer'),
    transcript: document.getElementById('transcript'),
    errors: document.getElementById('errors'),
  };

  /** Turn currently being streamed, so a stale turn's tokens are ignored. */
  let activeTurnId = null;

  function setStatus(state) {
    const live = Boolean(state.capturing);
    const stt = state.stt ?? 'stopped';

    el.dot.className =
      'dot' + (live && stt === 'ready' ? ' live' : stt === 'failed' ? ' error' : '');

    let label;
    if (stt === 'starting') label = 'loading model…';
    else if (stt === 'failed') label = 'transcription offline';
    else if (!live) label = 'idle';
    else if (stt !== 'ready') label = 'waiting for model';
    else if (state.llm === 'offline') label = 'listening · no LLM';
    else if (state.llm === 'no-model') label = 'listening · model not pulled';
    else label = 'listening';

    if (state.dropped > 0) label += ` · ${state.dropped} dropped`;

    el.statusText.textContent = label;
    el.body.classList.toggle('interactive', Boolean(state.interactive));

    if (typeof state.level === 'number' && state.speakerLevel) {
      const bar = state.speakerLevel === 'user' ? el.meterUser : el.meterRemote;
      bar.style.width = Math.min(100, Math.round(state.level * 100)) + '%';
    }
  }

  api.onStatus(setStatus);

  api.onMode((mode) => {
    el.body.classList.toggle('interactive', Boolean(mode.interactive));
  });

  api.onTurnStart((turn) => {
    activeTurnId = turn.turnId;
    el.answer.textContent = '';
    el.answer.classList.add('streaming');
  });

  api.onToken(({ turnId, token }) => {
    // A turn aborted mid-stream keeps emitting for a tick; drop those tokens
    // rather than interleaving two answers in one element.
    if (turnId !== activeTurnId) return;
    el.answer.textContent += token;
    el.answer.scrollTop = el.answer.scrollHeight;
  });

  api.onTurnEnd((turn) => {
    if (turn.turnId !== activeTurnId) return;
    el.answer.classList.remove('streaming');
    if (turn.aborted) el.answer.textContent += ' …';
    activeTurnId = null;
  });

  api.onTranscriptFinal((segment) => {
    const line = document.createElement('div');
    line.className = segment.speaker === 'user' ? 'user' : 'remote';
    line.textContent =
      (segment.speaker === 'user' ? 'you: ' : 'them: ') + segment.text;
    el.transcript.appendChild(line);
    // Bound the DOM the same way graph state is bounded.
    while (el.transcript.childElementCount > 40) {
      el.transcript.removeChild(el.transcript.firstElementChild);
    }
    el.transcript.scrollTop = el.transcript.scrollHeight;
  });

  api.onError((err) => {
    el.dot.className = 'dot error';
    el.errors.textContent = `[${err.scope}] ${err.message}`;
  });

  api.ready();
})();
