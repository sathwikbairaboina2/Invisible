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
    /** Whole-window opacity; drop below 1 to keep slides readable behind it. */
    opacity: 1,
  },

  audio: {
    /** Whisper wants 16 kHz mono PCM. Requesting this rate on the AudioContext
     *  makes Chromium resample every source with a proper anti-alias filter. */
    sampleRate: 16000,

    /** Silero model. 'v5' is more accurate than the package default, 'legacy'. */
    model: 'v5',

    /**
     * Silero VAD tuning. @ricky0123/vad-web 0.0.30 takes milliseconds, not
     * frame counts. One v5 frame is 512 samples at 16 kHz = 32 ms, so the
     * frame-count values these were derived from are 12 / 6 / 6.
     */
    vad: {
      positiveSpeechThreshold: 0.55,
      negativeSpeechThreshold: 0.4,
      /** Silence tolerated mid-utterance before speech is considered over. */
      redemptionMs: 384,
      /**
       * Per-mode redemption. Interview questions carry real hesitations —
       * measured 2026-08-20: the window absorbs gaps up to roughly its value
       * minus 100 ms, and mid-question pauses run 500-1000 ms — so interviews
       * tolerate more silence before an utterance closes. An explicit
       * operator override of redemptionMs beats both of these.
       */
      redemptionMsByMode: {
        interview: 640,
        meeting: 384,
      },
      /** Discard utterances shorter than this — coughs, keyboard clicks. */
      minSpeechMs: 192,
      /** Prepended context so the first phoneme is not clipped. */
      preSpeechPadMs: 192,
      /**
       * Speculative transcription: after this many consecutive silent frames
       * (32 ms each) mid-utterance, the audio so far is transcribed while the
       * redemption window is still open. If the utterance then ends in that
       * same silence, the draft is reused and the whisper cost plus the rest
       * of the window vanish from the latency path. 0 disables.
       */
      speculativeFrames: 6,
    },
    /** Hard cap so a monologue cannot grow an unbounded buffer. */
    maxUtteranceMs: 30000,
  },

  whisper: {
    /** Relative to the project root; populated by `npm run fetch-whisper`. */
    binary: 'bin/whisper-server.exe',
    model: 'models/ggml-large-v3-turbo.bin',
    host: '127.0.0.1',
    /** Chosen to avoid the usual 8080/3000 collisions. */
    port: 8178,
    /** whisper.cpp threads. The GPU does the work; these feed it. */
    threads: 8,
    language: 'en',
    /** Loading 1.6 GB onto the GPU is not instant on a cold filesystem cache. */
    startupTimeoutMs: 90000,
    /** Per-utterance HTTP timeout. */
    requestTimeoutMs: 30000,
    /** Restart attempts after an unexpected exit, before giving up. */
    maxRestarts: 3,
    /**
     * Utterances allowed to wait for the single model instance. Beyond this the
     * oldest is dropped and counted — a backlog that keeps growing means the
     * overlay is answering questions from a minute ago, which is worse than
     * missing one.
     */
    maxQueueDepth: 8,
  },

  corpus: {
    /**
     * Where the operator's markdown lives. Relative paths resolve from the
     * project root. Override with INVISIBLE_CORPUS_DIR to point at notes kept
     * outside the repo — an Obsidian vault, for instance.
     */
    dir: process.env.INVISIBLE_CORPUS_DIR || 'corpus',
    /** Sections longer than this are split again on paragraph boundaries. */
    maxChunkChars: 1200,
  },

  agent: {
    // The Ollama installed on the host, on its default port, shared by every
    // project on this machine. See docker/compose.yml for why no container.
    ollamaBaseUrl: process.env.OLLAMA_HOST || 'http://127.0.0.1:11434',
    model: process.env.INVISIBLE_MODEL || 'qwen3.8:27b',
    embedModel: process.env.INVISIBLE_EMBED_MODEL || 'nomic-embed-text',
    temperature: 0.2,
    /** Caps a runaway answer; the requested shape is under 60 words. */
    numPredict: 200,
    /** Keeps the 17 GB model resident between questions. */
    keepAlive: '30m',
    /** Dialogue turns sent to the model, so follow-up questions resolve. */
    historyTurns: 8,
    /** Transcript turns retained in graph state. Older turns are dropped. */
    transcriptWindow: 40,
    /**
     * Rolling-summary cadence: turns falling out of the historyTurns window
     * are folded into an <80-word running summary every this-many new turns.
     */
    summary: { everyTurns: 6 },
    qdrant: {
      url: process.env.QDRANT_URL || 'http://127.0.0.1:6333',
      collection: 'invisible_context',
      topK: 4,
      /**
       * Below this cosine score, retrieved chunks are treated as noise.
       *
       * 0.6, not the 0.45 originally guessed. nomic-embed-text scores any two
       * English sentences highly, so measured on a real corpus a pure
       * algorithms question still pulled a résumé story at 0.51. With the
       * model's task prefixes applied, genuine hits land at 0.62-0.72 and
       * irrelevant ones peak around 0.56, which is where this sits.
       *
       * The threshold exists to exclude, not to maximise recall: the overlay
       * shows four lines and a marginal match displaces real answer.
       */
      scoreThreshold: 0.6,
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
    openSettings: 'Control+Shift+,',
    /** Flip interview <-> meeting. Persisted; survives restart. */
    toggleMode: 'Control+Shift+M',
    /** Open the typed-ask input on the overlay. */
    askInput: 'Control+Shift+/',
    /** Cycle the answer style preset: auto, bullets, spoken, brief. */
    cycleStyle: 'Control+Shift+.',
    /** Write the meeting log to Documents/Invisible and reveal the file. */
    exportMeeting: 'Control+Shift+E',
    /** Answer the text currently on the clipboard. */
    askClipboard: 'Control+Shift+;',
    /** Jump the overlay to the next screen corner. */
    cycleCorner: 'Control+Shift+O',
    /** Restart capture — the way back from panic without relaunching. */
    resumeCapture: "Control+Shift+'",
    /** OCR the primary screen and answer whatever it asks. */
    askScreen: 'Control+Shift+G',
  },
};
