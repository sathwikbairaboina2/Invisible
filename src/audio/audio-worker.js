'use strict';

(function () {
  const api = window.invisibleAudio;

  /**
   * Absolute file:// URLs for the vendored assets.
   *
   * These must not be page-relative. `baseAssetPath` is resolved by the VAD
   * bundle relative to its own script location, and `onnxWASMBasePath` is
   * handed to ONNX Runtime, which resolves it the same way — so a page-relative
   * './vendor/ort/' becomes 'vendor/vad/vendor/ort/' and 404s. Absolute URLs
   * are unambiguous for both consumers.
   */
  const ASSETS = {
    vad: new URL('./vendor/vad/', window.location.href).href,
    ort: new URL('./vendor/ort/', window.location.href).href,
  };

  /** Running chains, keyed by speaker tag. */
  const chains = new Map();
  /** @type {AudioContext | null} */
  let ctx = null;
  /** @type {number | null} */
  let meterTimer = null;

  /**
   * One AudioContext shared by both chains.
   *
   * Requesting 16 kHz makes Chromium resample every MediaStreamSource with a
   * proper anti-alias filter, which is the rate Whisper and Silero both expect.
   * Doing it here removes any need for a hand-written resampler.
   */
  function audioContext() {
    if (!ctx) ctx = new AudioContext({ sampleRate: 16000 });
    return ctx;
  }

  /**
   * Options for one MicVAD instance.
   *
   * MicVAD is the only real-time class @ricky0123/vad-web@0.0.30 exports, but
   * its `getStream` hook means it is not tied to the microphone: handing it an
   * already-acquired stream is how the loopback chain reuses the same class.
   * `audioContext` is passed so both chains share one context — MicVAD then
   * treats the context as borrowed and will not close it on destroy().
   */
  function vadOptions(cfg, speaker, context, stream) {
    /**
     * Speculative-transcription bookkeeping. onFrameProcessed hands us every
     * 32 ms frame with its speech probability, which is enough to rebuild the
     * utterance audio ourselves and ship a draft mid-silence — while MicVAD's
     * own redemption window is still deciding whether the speaker is done.
     */
    const speculativeFrames = cfg.vad.speculativeFrames ?? 0;
    const preFrames = Math.ceil((cfg.vad.preSpeechPadMs ?? 0) / 32);
    const maxFrames = Math.ceil((cfg.maxUtteranceMs ?? 30000) / 32) + preFrames;
    /** Rolling pre-speech context while idle. @type {Float32Array[]} */
    let ring = [];
    /** Frames of the utterance in progress. @type {Float32Array[]} */
    let collected = [];
    let collecting = false;
    let lowRun = 0;
    let partialSeq = 0;
    let lastPartialId = null;
    /** True while the silence that produced lastPartialId is still unbroken. */
    let silenceUnbroken = false;

    function emitPartial() {
      const samples = collected.reduce((n, f) => n + f.length, 0);
      const pcm = new Float32Array(samples);
      let offset = 0;
      for (const frame of collected) {
        pcm.set(frame, offset);
        offset += frame.length;
      }
      lastPartialId = `${speaker}-${++partialSeq}`;
      silenceUnbroken = true;
      api.utterancePartial({
        speaker,
        pcm: pcm.buffer,
        sampleRate: cfg.sampleRate,
        durationMs: Math.round((pcm.length / cfg.sampleRate) * 1000),
        partialId: lastPartialId,
      });
    }

    function onFrame(probs, frame) {
      if (speculativeFrames <= 0) return;
      // Frames may be reused by the worklet; copy before keeping a reference.
      const copy = new Float32Array(frame);
      if (!collecting) {
        ring.push(copy);
        if (ring.length > preFrames) ring.shift();
        return;
      }
      if (collected.length < maxFrames) collected.push(copy);

      if (probs.isSpeech < cfg.vad.negativeSpeechThreshold) {
        lowRun += 1;
        // Exactly once per silence episode, part-way into the redemption
        // window: late enough to skip breath pauses, early enough to matter.
        if (lowRun === speculativeFrames) emitPartial();
      } else {
        lowRun = 0;
        silenceUnbroken = false;
      }
    }

    return {
      audioContext: context,
      getStream: async () => stream,
      // The stream's lifetime is owned by this module, not by MicVAD.
      pauseStream: async () => {},
      resumeStream: async () => stream,
      startOnLoad: true,
      processorType: 'AudioWorklet',

      model: cfg.model,
      // Absolute; see ASSETS. Trailing slashes are required by both consumers.
      baseAssetPath: ASSETS.vad,
      onnxWASMBasePath: ASSETS.ort,

      positiveSpeechThreshold: cfg.vad.positiveSpeechThreshold,
      negativeSpeechThreshold: cfg.vad.negativeSpeechThreshold,
      redemptionMs: cfg.vad.redemptionMs,
      minSpeechMs: cfg.vad.minSpeechMs,
      preSpeechPadMs: cfg.vad.preSpeechPadMs,
      // Pausing must not manufacture a half-utterance.
      submitUserSpeechOnPause: false,

      onFrameProcessed: onFrame,

      onSpeechStart: () => {
        collecting = true;
        collected = ring.slice();
        ring = [];
        lowRun = 0;
        silenceUnbroken = false;
        api.speechStart(speaker);
      },

      /** @param {Float32Array} audio mono, 16 kHz, samples in [-1, 1] */
      onSpeechEnd: (audio) => {
        const maxSamples = Math.round((cfg.maxUtteranceMs / 1000) * cfg.sampleRate);
        const clipped = audio.length > maxSamples ? audio.subarray(0, maxSamples) : audio;
        // subarray shares the parent buffer, so copy before handing the buffer
        // across the bridge — otherwise the receiver sees the whole recording.
        const pcm = new Float32Array(clipped);

        api.utterance({
          speaker,
          pcm: pcm.buffer,
          sampleRate: cfg.sampleRate,
          durationMs: Math.round((pcm.length / cfg.sampleRate) * 1000),
          // Reusable only when the utterance ended inside the same silence
          // that triggered the draft; resumed speech invalidated it.
          partialId: silenceUnbroken ? lastPartialId : null,
        });
        collecting = false;
        collected = [];
        lowRun = 0;
        silenceUnbroken = false;
      },

      // Speech that never reached minSpeechMs — a cough, a keystroke.
      onVADMisfire: () => {
        collecting = false;
        collected = [];
        lowRun = 0;
        silenceUnbroken = false;
      },
    };
  }

  /**
   * MicVAD builds its own MediaStreamSource internally, so this taps the same
   * stream a second time purely to drive the level meter. Two source nodes off
   * one stream is fine; they are independent readers.
   */
  function attachMeter(context, stream) {
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    return { source, analyser, buf: new Float32Array(analyser.fftSize) };
  }

  async function startChain({ speaker, stream, cfg }) {
    const context = audioContext();
    if (context.state === 'suspended') await context.resume();

    const meter = attachMeter(context, stream);
    const node = await window.vad.MicVAD.new(vadOptions(cfg, speaker, context, stream));
    await node.start();

    chains.set(speaker, { stream, node, ...meter });
  }

  function startMeters() {
    if (meterTimer !== null) return;
    meterTimer = setInterval(() => {
      for (const [speaker, chain] of chains) {
        chain.analyser.getFloatTimeDomainData(chain.buf);
        let sum = 0;
        for (let i = 0; i < chain.buf.length; i++) sum += chain.buf[i] * chain.buf[i];
        const rms = Math.sqrt(sum / chain.buf.length);
        api.level(speaker, Math.min(1, rms * 4));
      }
    }, 120);
  }

  async function stopAll() {
    if (meterTimer !== null) {
      clearInterval(meterTimer);
      meterTimer = null;
    }
    for (const chain of chains.values()) {
      try {
        await chain.node.destroy();
      } catch (_) {
        /* already torn down */
      }
      chain.source.disconnect();
      for (const track of chain.stream.getTracks()) track.stop();
    }
    chains.clear();
  }

  /**
   * System audio. Chromium requires a video source for this request to resolve
   * even when only audio is wanted, so main's display-media handler returns a
   * screen source alongside `audio: 'loopback'`. The video track is stopped
   * here immediately — it is never read, and leaving it running holds a real
   * screen-capture session open.
   */
  async function acquireLoopback() {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });

    for (const track of stream.getVideoTracks()) {
      stream.removeTrack(track);
      track.stop();
    }

    if (stream.getAudioTracks().length === 0) {
      throw new Error('loopback returned no audio track');
    }
    return stream;
  }

  api.onStart(async (payload) => {
    const cfg = payload && payload.audio;
    if (!cfg) {
      api.error('audio:start arrived without a config payload');
      return;
    }

    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
        video: false,
      });
      await startChain({ speaker: 'user', stream: mic, cfg });
    } catch (err) {
      api.error(`microphone unavailable: ${err.message}`);
      return;
    }

    try {
      const loopback = await acquireLoopback();
      await startChain({ speaker: 'remote', stream: loopback, cfg });
    } catch (err) {
      // Non-fatal by design: a working mic chain alone is still useful, and
      // failing the whole worker here would take the transcript down with it.
      api.error(`system audio unavailable: ${err.message}`);
    }

    startMeters();
    api.ready();
  });

  api.onStop(() => {
    stopAll();
  });

  window.addEventListener('beforeunload', () => {
    stopAll();
  });
})();
