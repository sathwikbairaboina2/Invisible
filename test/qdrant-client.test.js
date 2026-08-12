'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createRetrievalClient } = require('../src/qdrant/client');

/** Records calls and returns canned Qdrant responses. */
function fakeQdrant(hits, record = {}) {
  return {
    async query(collection, args) {
      record.collection = collection;
      record.args = args;
      return { points: hits };
    },
    async getCollections() {
      return { collections: [{ name: 'invisible_context' }] };
    },
    async getCollection() {
      return { points_count: 42 };
    },
    async recreateCollection(name, args) {
      record.created = { name, args };
    },
    async upsert(name, args) {
      record.upserted = { name, args };
    },
  };
}

const fakeEmbed = (vector = [0.1, 0.2, 0.3]) => ({
  embedQuery: async () => vector,
  embedDocuments: async (texts) => texts.map(() => vector),
});

test('returns hits above the score threshold', async () => {
  const client = createRetrievalClient({
    url: 'http://x',
    collection: 'invisible_context',
    topK: 4,
    scoreThreshold: 0.45,
    embedImpl: fakeEmbed(),
    qdrantImpl: fakeQdrant([
      { score: 0.81, payload: { text: 'Built a CDC pipeline.', source: 'p.md', heading: 'CDC' } },
      { score: 0.62, payload: { text: 'Ran a Postgres migration.', source: 'p.md', heading: 'PG' } },
    ]),
  });

  const hits = await client.search('Tell me about a data project.');

  assert.equal(hits.length, 2);
  assert.equal(hits[0].text, 'Built a CDC pipeline.');
  assert.equal(hits[0].score, 0.81);
  assert.equal(hits[0].source, 'p.md');
  assert.equal(hits[0].heading, 'CDC');
});

test('drops hits below the threshold', async () => {
  // Irrelevant context is worse than none: the overlay shows four lines, and a
  // marginal match displaces a line of actual answer.
  const client = createRetrievalClient({
    url: 'http://x',
    collection: 'c',
    scoreThreshold: 0.45,
    embedImpl: fakeEmbed(),
    qdrantImpl: fakeQdrant([
      { score: 0.72, payload: { text: 'relevant', source: 'a.md', heading: 'A' } },
      { score: 0.44, payload: { text: 'marginal', source: 'b.md', heading: 'B' } },
      { score: 0.1, payload: { text: 'noise', source: 'c.md', heading: 'C' } },
    ]),
  });

  const hits = await client.search('q');
  assert.deepEqual(
    hits.map((h) => h.text),
    ['relevant']
  );
});

test('applies nomic task prefixes, asymmetrically', async () => {
  // nomic-embed-text is trained with "search_query: " on queries and
  // "search_document: " on indexed passages. Measured on this corpus, using
  // them widens the gap between a relevant hit and an irrelevant one enough to
  // put a usable threshold between the two; without them the scores of a real
  // match and a nonsense match overlap.
  //
  // The two prefixes must not be swapped or shared: the asymmetry is the point.
  const seen = { queries: [], documents: [] };
  const client = createRetrievalClient({
    url: 'http://x',
    collection: 'c',
    embedImpl: {
      embedQuery: async (text) => {
        seen.queries.push(text);
        return [0.1];
      },
      embedDocuments: async (texts) => {
        seen.documents.push(...texts);
        return texts.map(() => [0.1]);
      },
    },
    qdrantImpl: fakeQdrant([]),
  });

  await client.search('How did you scale it?');
  await client.upsertChunks([
    { text: 'Built a CDC pipeline.', heading: 'CDC', source: 'p.md', index: 0 },
  ]);

  assert.equal(seen.queries[0], 'search_query: How did you scale it?');
  assert.equal(seen.documents[0], 'search_document: Built a CDC pipeline.');
});

test('asks Qdrant for topK results using the embedded query', async () => {
  const record = {};
  const client = createRetrievalClient({
    url: 'http://x',
    collection: 'invisible_context',
    topK: 3,
    embedImpl: fakeEmbed([0.5, 0.6]),
    qdrantImpl: fakeQdrant([], record),
  });

  await client.search('How did you scale it?');

  assert.equal(record.collection, 'invisible_context');
  assert.deepEqual(record.args.query, [0.5, 0.6]);
  assert.equal(record.args.limit, 3);
  assert.equal(record.args.with_payload, true);
});

test('a dead Qdrant yields no context instead of an error', async () => {
  // Phase 1's createRetriever swallows this, but the client must not be the
  // thing that turns a missing nice-to-have into a failed turn.
  const client = createRetrievalClient({
    url: 'http://x',
    collection: 'c',
    embedImpl: fakeEmbed(),
    qdrantImpl: {
      async query() {
        throw new Error('ECONNREFUSED');
      },
    },
  });

  assert.deepEqual(await client.search('q'), []);
});

test('a failing embedder yields no context instead of an error', async () => {
  const client = createRetrievalClient({
    url: 'http://x',
    collection: 'c',
    embedImpl: {
      embedQuery: async () => {
        throw new Error('ollama down');
      },
    },
    qdrantImpl: fakeQdrant([]),
  });

  assert.deepEqual(await client.search('q'), []);
});

test('an empty query is not sent to the embedder', async () => {
  let called = false;
  const client = createRetrievalClient({
    url: 'http://x',
    collection: 'c',
    embedImpl: {
      embedQuery: async () => {
        called = true;
        return [0.1];
      },
    },
    qdrantImpl: fakeQdrant([]),
  });

  assert.deepEqual(await client.search('   '), []);
  assert.equal(called, false);
});

test('probe reports collection presence and point count', async () => {
  const client = createRetrievalClient({
    url: 'http://x',
    collection: 'invisible_context',
    embedImpl: fakeEmbed(),
    qdrantImpl: fakeQdrant([]),
  });

  const result = await client.probe();
  assert.equal(result.ok, true);
  assert.equal(result.exists, true);
  assert.equal(result.points, 42);
});

test('probe reports an unreachable Qdrant without throwing', async () => {
  const client = createRetrievalClient({
    url: 'http://x',
    collection: 'c',
    embedImpl: fakeEmbed(),
    qdrantImpl: {
      async getCollections() {
        throw new Error('fetch failed');
      },
    },
  });

  const result = await client.probe();
  assert.equal(result.ok, false);
  assert.equal(result.exists, false);
  assert.match(result.error, /fetch failed/);
});

test('ensureCollection sizes the vector from a real embedding', async () => {
  // The dimension is not documented for nomic-embed-text, and a mismatch makes
  // Qdrant reject every upsert. Measuring beats asserting.
  const record = {};
  const client = createRetrievalClient({
    url: 'http://x',
    collection: 'invisible_context',
    embedImpl: fakeEmbed(new Array(768).fill(0.01)),
    qdrantImpl: fakeQdrant([], record),
  });

  const size = await client.ensureCollection();

  assert.equal(size, 768);
  assert.equal(record.created.name, 'invisible_context');
  assert.equal(record.created.args.vectors.size, 768);
  assert.equal(record.created.args.vectors.distance, 'Cosine');
});

test('upsertChunks stores the text and its provenance as payload', async () => {
  const record = {};
  const client = createRetrievalClient({
    url: 'http://x',
    collection: 'invisible_context',
    embedImpl: fakeEmbed([0.1, 0.2]),
    qdrantImpl: fakeQdrant([], record),
  });

  await client.upsertChunks([
    { text: 'Built a CDC pipeline.', heading: 'CDC', source: 'projects.md', index: 0 },
    { text: 'Ran a migration.', heading: 'PG', source: 'projects.md', index: 1 },
  ]);

  const points = record.upserted.args.points;
  assert.equal(points.length, 2);
  assert.equal(points[0].id, 0);
  assert.deepEqual(points[0].vector, [0.1, 0.2]);
  assert.equal(points[0].payload.text, 'Built a CDC pipeline.');
  assert.equal(points[0].payload.source, 'projects.md');
  assert.equal(points[0].payload.heading, 'CDC');
});
