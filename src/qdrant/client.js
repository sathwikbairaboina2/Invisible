'use strict';

const { QdrantClient } = require('@qdrant/js-client-rest');
const { OllamaEmbeddings } = require('@langchain/ollama');

/**
 * Embedding + vector search against a local Qdrant.
 *
 * `embedImpl` and `qdrantImpl` are injected so every path is testable without
 * either service running. Nothing here knows about Electron or LangGraph.
 *
 * @param {{url: string, collection: string, topK?: number,
 *          scoreThreshold?: number, ollamaBaseUrl?: string, embedModel?: string,
 *          embedImpl?: object, qdrantImpl?: object}} options
 */
/**
 * nomic-embed-text is trained with asymmetric task prefixes. Measured on a real
 * corpus, applying them widens the margin between a relevant hit and an
 * irrelevant one enough to fit a usable threshold between the two; without them
 * a genuine match and a nonsense match score close enough to overlap.
 *
 * These must stay asymmetric — the same prefix on both sides throws away the
 * distinction the model was trained to make.
 */
const QUERY_PREFIX = 'search_query: ';
const DOCUMENT_PREFIX = 'search_document: ';

function createRetrievalClient({
  url,
  collection,
  topK = 4,
  scoreThreshold = 0.6,
  ollamaBaseUrl,
  embedModel = 'nomic-embed-text',
  embedImpl,
  qdrantImpl,
} = {}) {
  if (!url) throw new TypeError('createRetrievalClient: url is required');
  if (!collection) throw new TypeError('createRetrievalClient: collection is required');

  const embedder =
    embedImpl ??
    new OllamaEmbeddings({
      model: embedModel,
      baseUrl: ollamaBaseUrl,
      // The embedding model is small and used rarely; letting it unload frees
      // VRAM for the generation model between ingests.
      keepAlive: '5m',
    });

  const qdrant = qdrantImpl ?? new QdrantClient({ url });

  /**
   * @param {string} text
   * @returns {Promise<Array<{text: string, score: number, source: string, heading: string}>>}
   */
  async function search(text) {
    const query = String(text ?? '').trim();
    // Nothing to match, and no reason to spend an embedding call finding out.
    if (query.length === 0) return [];

    try {
      const vector = await embedder.embedQuery(QUERY_PREFIX + query);
      const response = await qdrant.query(collection, {
        query: vector,
        limit: topK,
        with_payload: true,
      });

      return (response?.points ?? [])
        .filter((point) => point.score >= scoreThreshold)
        .map((point) => ({
          text: point.payload?.text ?? '',
          score: point.score,
          source: point.payload?.source ?? '',
          heading: point.payload?.heading ?? '',
        }));
    } catch (_err) {
      // Context is a nice-to-have. A dead Qdrant, a missing collection, or a
      // dead embedder must all degrade to "answer without context" rather than
      // failing the turn.
      return [];
    }
  }

  /** @returns {Promise<{ok: boolean, exists: boolean, points: number, error?: string}>} */
  async function probe() {
    try {
      const listing = await qdrant.getCollections();
      const exists = (listing?.collections ?? []).some((entry) => entry.name === collection);
      if (!exists) return { ok: true, exists: false, points: 0 };

      const info = await qdrant.getCollection(collection);
      return { ok: true, exists: true, points: info?.points_count ?? 0 };
    } catch (err) {
      return { ok: false, exists: false, points: 0, error: err.message };
    }
  }

  /**
   * Creates the collection, sizing the vector from a real embedding.
   *
   * The dimension of nomic-embed-text is not documented on Ollama's model page,
   * and a Qdrant collection rejects every upsert whose size differs from its
   * declaration. Measuring costs one embedding call and stays correct across a
   * model swap.
   *
   * @returns {Promise<number>} the discovered vector size
   */
  async function ensureCollection() {
    const probeVector = await embedder.embedQuery('dimension probe');
    const size = probeVector.length;

    // Recreate rather than merge: ingest rebuilds from the corpus, so a file
    // the operator deleted must disappear from the index too.
    await qdrant.recreateCollection(collection, {
      vectors: { size, distance: 'Cosine' },
    });

    return size;
  }

  /**
   * @param {Array<{text: string, heading: string, source: string, index: number}>} chunks
   */
  async function upsertChunks(chunks) {
    if (chunks.length === 0) return;

    const vectors = await embedder.embedDocuments(
      chunks.map((chunk) => DOCUMENT_PREFIX + chunk.text)
    );

    await qdrant.upsert(collection, {
      wait: true,
      points: chunks.map((chunk, i) => ({
        id: i,
        vector: vectors[i],
        payload: { text: chunk.text, source: chunk.source, heading: chunk.heading },
      })),
    });
  }

  return { search, probe, ensureCollection, upsertChunks };
}

module.exports = { createRetrievalClient };
