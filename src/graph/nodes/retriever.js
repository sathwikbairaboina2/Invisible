'use strict';

/**
 * Phase 1 stub — always returns nothing. Phase 4 injects a Qdrant `search`
 * function with the same signature.
 *
 * @param {{search?: (text: string) => Promise<Array<{text: string, score: number}>>,
 *          scoreThreshold?: number}} deps
 */
function createRetriever({ search, scoreThreshold = 0.45 } = {}) {
  return async function retriever(state) {
    if (!search) return { retrieved: [] };

    try {
      const hits = await search(state.utterance);
      return { retrieved: hits.filter((h) => h.score >= scoreThreshold) };
    } catch (err) {
      // A dead vector store degrades to "answer without context", never to a
      // failed turn.
      return { retrieved: [], retrievalError: err.message };
    }
  };
}

module.exports = { createRetriever };
