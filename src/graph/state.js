'use strict';

const { Annotation } = require('@langchain/langgraph');
const config = require('../main/config');

const TRANSCRIPT_WINDOW = config.agent.transcriptWindow;

/**
 * Graph state. Fields declared with bare `Annotation()` use LangGraph's default
 * last-write-wins reducer; only `transcript` accumulates.
 */
const AgentState = Annotation.Root({
  /** Correlates streamed tokens to one overlay element. */
  turnId: Annotation(),

  /** Transient audio input. Dropped once the transcriber has run. */
  pcm: Annotation(),

  /** Sample rate of `pcm`, carried so the transcriber need not assume. */
  sampleRate: Annotation(),

  /** 'user' (microphone) or 'remote' (system loopback). */
  speaker: Annotation(),

  /** Transcriber output for this turn. */
  utterance: Annotation(),

  /** Rolling dialogue, oldest turns discarded. */
  transcript: Annotation({
    reducer: (previous, update) => {
      const merged = (previous ?? []).concat(update ?? []);
      return merged.length > TRANSCRIPT_WINDOW
        ? merged.slice(merged.length - TRANSCRIPT_WINDOW)
        : merged;
    },
    default: () => [],
  }),

  /** Qdrant hits above the score threshold. Empty when triage said ignore. */
  retrieved: Annotation({ default: () => [] }),

  /** Set by the retriever when the vector store is unreachable. */
  retrievalError: Annotation(),

  /** Set by the manual-ask shortcut to bypass triage for one turn. */
  forceRespond: Annotation({ default: () => false }),

  /** Triage verdict. Drives the conditional edge. */
  shouldRespond: Annotation({ default: () => false }),

  /** Accumulated generated text. */
  response: Annotation({ default: () => '' }),
});

module.exports = { AgentState, TRANSCRIPT_WINDOW };
