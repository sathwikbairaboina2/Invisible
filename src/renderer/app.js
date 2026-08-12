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
    el.dot.className = 'dot' + (live ? ' live' : '');
    el.statusText.textContent = live ? 'listening' : 'idle';
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
