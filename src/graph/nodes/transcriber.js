'use strict';

/**
 * Phase 1 stub. Phase 2 replaces the injected `transcribe` with an HTTP call to
 * the whisper.cpp sidecar; nothing else in this file changes.
 *
 * @param {{transcribe?: (pcm: Float32Array, sampleRate: number) => Promise<string>,
 *          onTranscriptFinal?: (segment: {speaker: string, text: string}) => void}} deps
 */
function createTranscriber({ transcribe, onTranscriptFinal } = {}) {
  const recognise =
    transcribe ??
    (async (pcm, sampleRate) => {
      const seconds = (pcm?.length ?? 0) / (sampleRate || 16000);
      return `[stub transcript, ${seconds.toFixed(1)}s of audio]`;
    });

  return async function transcriber(state) {
    // The manual-ask shortcut re-runs a turn with no audio: the utterance is
    // already known, and re-transcribing would both waste a call and append a
    // duplicate transcript line for something the operator already saw.
    if (!state.pcm) return { utterance: state.utterance ?? '' };

    const text = (await recognise(state.pcm, state.sampleRate ?? 16000)).trim();

    // whisper returns '' for audio it judged non-speech — a cough or a door
    // that got past the VAD. Emitting it would put a blank line in the
    // transcript and hand triage an empty utterance to reason about.
    if (text.length === 0) {
      return { utterance: '', pcm: null };
    }

    // The transcript is emitted regardless of the triage verdict that follows,
    // so the operator always sees the whole conversation.
    onTranscriptFinal?.({ speaker: state.speaker, text });

    return {
      utterance: text,
      transcript: [{ speaker: state.speaker, text }],
      // Release the audio as soon as it has been consumed.
      pcm: null,
    };
  };
}

module.exports = { createTranscriber };
