'use strict';

/**
 * Single source of truth for tunables. Kept as plain data so it can later be
 * merged with a user-editable JSON file without touching call sites.
 */
module.exports = {
  overlay: {
    width: 560,
    height: 460,
    margin: 24,
    /** Pixels moved per nudge shortcut press. */
    nudgeStep: 40,
  },

  audio: {
    /** Whisper wants 16 kHz mono PCM. Resampling happens in the worker. */
    sampleRate: 16000,
    /** Audio worklet frame size. 128 is the Web Audio quantum. */
    frameSize: 128,
    /** Silero VAD thresholds. */
    vad: {
      positiveSpeechThreshold: 0.55,
      negativeSpeechThreshold: 0.4,
      /** Frames of silence before an utterance is considered finished. */
      redemptionFrames: 12,
      /** Discard utterances shorter than this — coughs, keyboard clicks. */
      minSpeechFrames: 6,
      /** Prepended context so the first phoneme is not clipped. */
      preSpeechPadFrames: 6,
    },
    /** Hard cap so a monologue cannot grow an unbounded buffer. */
    maxUtteranceMs: 30000,
  },

  agent: {
    ollamaBaseUrl: process.env.OLLAMA_HOST || 'http://127.0.0.1:11434',
    model: process.env.INVISIBLE_MODEL || 'qwen2.5-coder:14b-instruct-q4_K_M',
    /** Small model used only by the triage node to gate generation. */
    triageModel: process.env.INVISIBLE_TRIAGE_MODEL || 'llama3.2:1b',
    embedModel: process.env.INVISIBLE_EMBED_MODEL || 'nomic-embed-text',
    temperature: 0.2,
    /** Transcript turns retained in graph state. Older turns are dropped. */
    transcriptWindow: 40,
    qdrant: {
      url: process.env.QDRANT_URL || 'http://127.0.0.1:6333',
      collection: 'invisible_context',
      topK: 4,
      /** Below this cosine score, retrieved chunks are treated as noise. */
      scoreThreshold: 0.45,
    },
  },

  /**
   * Accelerators chosen to avoid collisions with IDEs, browsers, and Zoom.
   * Electron accelerator syntax: https://www.electronjs.org/docs/latest/api/accelerator
   */
  shortcuts: {
    // Electron accelerators take the literal punctuation character; there is no
    // 'Backslash' token, and passing one throws rather than returning false.
    toggleVisibility: 'Control+Shift+\\',
    toggleInteractive: 'Control+Shift+Enter',
    manualAsk: 'Control+Shift+Space',
    clearContext: 'Control+Shift+K',
    /** Stops capture, clears state, hides window. Single press, no confirm. */
    panic: 'Control+Shift+X',
    nudgeUp: 'Control+Shift+Up',
    nudgeDown: 'Control+Shift+Down',
    nudgeLeft: 'Control+Shift+Left',
    nudgeRight: 'Control+Shift+Right',
  },
};
