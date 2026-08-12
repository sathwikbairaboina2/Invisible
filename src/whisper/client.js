'use strict';

const { encodeWav } = require('./wav');

/**
 * whisper.cpp labels non-speech audio rather than returning an empty string.
 * These labels are not words and must never reach the transcript or triage.
 * Anchored to the whole string so a real sentence containing "music" survives.
 */
const NON_SPEECH =
  /^[\s]*[[(]\s*(blank_audio|silence|music|inaudible|no speech|sound|noise)\s*[\])][\s]*$/i;

/** True when `text` is empty, whitespace, or a whisper non-speech marker. */
function isNonSpeech(text) {
  const trimmed = String(text ?? '').trim();
  if (trimmed.length === 0) return true;
  return NON_SPEECH.test(trimmed);
}

/**
 * HTTP client for a local whisper.cpp server.
 *
 * `fetchImpl` is injected so the request shape can be asserted without a
 * running server. Nothing in this module knows about Electron or LangGraph.
 *
 * Deliberately takes no AbortSignal: transcription is never cancelled. The
 * transcript is the conversation record, and a superseded turn losing its line
 * would leave a hole the operator cannot reconstruct. Only generation aborts.
 *
 * @param {{baseUrl: string, fetchImpl?: typeof fetch, timeoutMs?: number,
 *          language?: string}} options
 */
function createWhisperClient({ baseUrl, fetchImpl = fetch, timeoutMs = 30000, language } = {}) {
  if (!baseUrl) throw new TypeError('createWhisperClient: baseUrl is required');

  const endpoint = `${baseUrl.replace(/\/+$/, '')}/inference`;

  /**
   * @param {Float32Array} pcm mono, in [-1, 1]
   * @param {number} sampleRate
   * @returns {Promise<{text: string, ms: number}>}
   */
  async function transcribe(pcm, sampleRate) {
    // A zero-length utterance is a VAD edge case, not something to ask a
    // 1.6 GB model about.
    if (!pcm || pcm.length === 0) return { text: '', ms: 0 };

    const wav = encodeWav(pcm, sampleRate);

    const form = new FormData();
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'utterance.wav');
    form.append('response_format', 'json');
    // Greedy decoding: this is a latency-sensitive path and sampling buys
    // nothing when the audio is already VAD-trimmed to one utterance.
    form.append('temperature', '0');
    if (language) form.append('language', language);

    const started = Date.now();

    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      // Covers a dead server, a refused connection, and the timeout above.
      throw new Error(`whisper: ${err.message}`);
    }

    if (!response.ok) {
      throw new Error(`whisper: HTTP ${response.status} ${response.statusText}`);
    }

    const payload = await response.json();
    if (typeof payload?.text !== 'string') {
      throw new Error('whisper: response had no text field');
    }

    // whisper.cpp joins its internal segments with newlines, so one spoken
    // sentence arrives split mid-clause. Collapsing all whitespace gives the
    // overlay a single readable line and keeps the prompt free of stray breaks.
    const normalized = payload.text.replace(/\s+/g, ' ').trim();

    return {
      text: isNonSpeech(normalized) ? '' : normalized,
      ms: Date.now() - started,
    };
  }

  return { transcribe };
}

module.exports = { createWhisperClient, isNonSpeech };
