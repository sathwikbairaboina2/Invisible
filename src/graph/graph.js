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

module.exports = { buildGraph };
