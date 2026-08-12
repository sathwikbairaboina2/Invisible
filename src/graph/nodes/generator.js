'use strict';

/**
 * Phase 1 stub. Emits a canned answer one word at a time on a timer so the
 * overlay's streaming path is exercised end to end before Ollama exists.
 * Phase 3 replaces `stream` with ChatOllama.stream(); the abort contract and
 * the token callback stay identical.
 *
 * @param {{stream?: (state: object, signal: AbortSignal) => AsyncIterable<string>,
 *          onToken?: (turnId: string, token: string) => void,
 *          tokenDelayMs?: number}} deps
 */
function createGenerator({ stream, onToken, tokenDelayMs = 35 } = {}) {
  async function* stubStream(state, signal) {
    const words = [
      'Stub', 'response', 'for:', `${state.utterance}`, '—',
      'the', 'real', 'generator', 'arrives', 'in', 'Phase', '3.',
    ];
    for (const word of words) {
      if (signal?.aborted) return;
      await new Promise((resolve) => setTimeout(resolve, tokenDelayMs));
      yield word + ' ';
    }
  }

  return async function generator(state, runtimeConfig) {
    const signal = runtimeConfig?.configurable?.signal;
    const turnId = state.turnId;

    // Checked before announcing, not after. Transcription does not honour the
    // abort signal — losing a transcript line is worse than a wasted turn — so
    // a superseded turn still arrives here, and announcing would open an
    // overlay bubble that is closed again on the very next line.
    if (signal?.aborted) return { response: '' };

    // Announced here rather than at turn start: a turn that triage rejects
    // never reaches this node, and must not open an empty bubble.
    runtimeConfig?.configurable?.announce?.();

    const source = stream ? stream(state, signal) : stubStream(state, signal);

    let accumulated = '';
    for await (const token of source) {
      if (signal?.aborted) break;
      accumulated += token;
      onToken?.(turnId, token);
    }

    return { response: accumulated };
  };
}

module.exports = { createGenerator };
