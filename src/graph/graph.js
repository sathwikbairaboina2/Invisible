'use strict';

const { StateGraph, START, END } = require('@langchain/langgraph');

const { AgentState } = require('./state');
const { routeAfterTriage } = require('./nodes/triage');

/**
 * Wires the four nodes into a compiled graph.
 *
 * Nodes are injected rather than imported so the routing can be tested without
 * a model, a vector store, or a speech recogniser.
 *
 *   START -> transcriber -> triage -+-(respond)-> retriever -> generator -> END
 *                                   +-(ignore)---------------------------> END
 *
 * @param {{transcriber: Function, triage: Function,
 *          retriever: Function, generator: Function}} nodes
 */
function buildGraph(nodes) {
  for (const name of ['transcriber', 'triage', 'retriever', 'generator']) {
    if (typeof nodes[name] !== 'function') {
      throw new TypeError(`buildGraph: node "${name}" must be a function`);
    }
  }

  return new StateGraph(AgentState)
    .addNode('transcriber', nodes.transcriber)
    .addNode('triage', nodes.triage)
    .addNode('retriever', nodes.retriever)
    .addNode('generator', nodes.generator)
    .addEdge(START, 'transcriber')
    .addEdge('transcriber', 'triage')
    .addConditionalEdges('triage', routeAfterTriage, {
      respond: 'retriever',
      ignore: END,
    })
    .addEdge('retriever', 'generator')
    .addEdge('generator', END)
    .compile();
}

const { createTriage } = require('./nodes/triage');
const { createTranscriber } = require('./nodes/transcriber');
const { createRetriever } = require('./nodes/retriever');
const { createGenerator } = require('./nodes/generator');

let turnCounter = 0;

/**
 * The only surface the main process touches. Main knows nothing about
 * LangGraph; the graph knows nothing about Electron.
 *
 * @param {{config?: object,
 *          onTurnStart?: Function, onToken?: Function, onTurnEnd?: Function,
 *          onTranscriptPartial?: Function, onTranscriptFinal?: Function,
 *          onError?: Function}} options
 */
function createAgentRuntime(options = {}) {
  const {
    config = {},
    onTurnStart,
    onToken,
    onTurnEnd,
    onTranscriptFinal,
    onError,
  } = options;

  const app = buildGraph({
    transcriber: createTranscriber({ onTranscriptFinal }),
    triage: createTriage({}),
    retriever: createRetriever({ scoreThreshold: config?.qdrant?.scoreThreshold }),
    generator: createGenerator({ onToken }),
  });

  /** Rolling transcript, owned here because each invoke() is stateless. */
  let transcript = [];
  /** @type {AbortController | null} */
  let inFlight = null;
  /** Last remote utterance, so the manual-ask shortcut has something to use. */
  let lastRemoteUtterance = '';
  let disposed = false;

  function abortInFlight() {
    if (inFlight && !inFlight.signal.aborted) inFlight.abort();
  }

  async function run({ speaker, pcm, sampleRate, utterance, forceRespond = false }) {
    if (disposed) return;

    // A new utterance always wins over one still generating.
    abortInFlight();
    const controller = new AbortController();
    inFlight = controller;

    const turnId = `turn-${++turnCounter}`;
    let started = false;

    try {
      const result = await app.invoke(
        {
          turnId,
          speaker,
          pcm,
          sampleRate,
          utterance,
          transcript,
          forceRespond,
        },
        {
          configurable: {
            signal: controller.signal,
            // Called by the generator, which only runs for turns that survived
            // triage — so a discarded utterance never opens an overlay bubble.
            announce: () => {
              if (started) return;
              started = true;
              onTurnStart?.({ turnId, speaker });
            },
          },
        }
      );

      transcript = result.transcript ?? transcript;
      if (speaker === 'remote' && result.utterance) lastRemoteUtterance = result.utterance;

      if (started) onTurnEnd?.({ turnId, aborted: controller.signal.aborted });
    } catch (err) {
      if (started) onTurnEnd?.({ turnId, aborted: true });
      onError?.(err);
    } finally {
      // Only clear if this turn is still the current one; a turn that was
      // superseded must not null out its successor's controller.
      if (inFlight === controller) inFlight = null;
    }
  }

  return {
    submitUtterance: ({ speaker, pcm, sampleRate }) => run({ speaker, pcm, sampleRate }),

    /** Manual-ask shortcut: re-run the last remote utterance, bypassing triage. */
    ask: (question) => {
      const text = question && question.trim() ? question.trim() : lastRemoteUtterance;
      if (!text) return Promise.resolve();
      // No pcm: the transcriber short-circuits and the utterance is reused, so
      // the transcript is not appended to twice for one spoken sentence.
      return run({
        speaker: 'remote',
        pcm: null,
        sampleRate: 16000,
        utterance: text,
        forceRespond: true,
      });
    },

    cancel: () => abortInFlight(),

    clear: () => {
      abortInFlight();
      transcript = [];
      lastRemoteUtterance = '';
    },

    transcriptLength: () => transcript.length,

    dispose: () => {
      abortInFlight();
      disposed = true;
    },
  };
}

module.exports = { buildGraph, createAgentRuntime };
