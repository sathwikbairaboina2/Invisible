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
  // No letters or digits means no words. Measured against the real model,
  // three seconds of white noise transcribes to " ." with a no-speech
  // probability of 1e-12 — it clears every confidence threshold, so content is
  // the only thing that catches it.
  if (!/[\p{L}\p{N}]/u.test(trimmed)) return true;
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
/**
 * Whisper hallucinates fluent sentences onto near-silence and room noise.
 * Observed in real use: "I need the Swarovs to produce now" from an empty
 * room, "Bagessele.", "The shapes there, man."
 *
 * The model knows — it reports a high no-speech probability, or a very low
 * average log-probability, or both — but the flat `text` field discards that.
 * Asking for verbose_json and filtering per segment is what makes it visible.
 *
 * Thresholds are the ones OpenAI's own reference decoder uses to suppress the
 * same failure.
 */
const NO_SPEECH_THRESHOLD = 0.6;
const LOGPROB_THRESHOLD = -1.0;

/** True when whisper's own scores say this segment is not speech. */
function isHallucinated(segment) {
  const noSpeech = typeof segment?.no_speech_prob === 'number' ? segment.no_speech_prob : 0;
  const logProb = typeof segment?.avg_logprob === 'number' ? segment.avg_logprob : 0;
  return noSpeech > NO_SPEECH_THRESHOLD || logProb < LOGPROB_THRESHOLD;
}

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
    // verbose_json rather than json: the flat text field hides the per-segment
    // confidence that distinguishes a real sentence from a hallucination.
    form.append('response_format', 'verbose_json');
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

    // Rebuilt from the segments that survive filtering, so a real question
    // preceded by a hallucinated fragment keeps the question. Falls back to the
    // flat field when a server or format returns no segments — better to
    // transcribe unfiltered than to transcribe everything to nothing.
    const segments = Array.isArray(payload.segments) ? payload.segments : null;
    const raw = segments
      ? segments
          .filter((segment) => !isHallucinated(segment))
          .map((segment) => segment.text ?? '')
          .join(' ')
      : payload.text;

    // whisper.cpp joins its internal segments with newlines, so one spoken
    // sentence arrives split mid-clause. Collapsing all whitespace gives the
    // overlay a single readable line and keeps the prompt free of stray breaks.
    const normalized = raw.replace(/\s+/g, ' ').trim();

    return {
      text: isNonSpeech(normalized) ? '' : normalized,
      ms: Date.now() - started,
    };
  }

  return { transcribe };
}

module.exports = { createWhisperClient, isNonSpeech };
