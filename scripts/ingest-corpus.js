'use strict';

/** CLI wrapper around the shared ingestion module. `npm run ingest`. */

const path = require('node:path');

const config = require('../src/main/config');
const { ingestCorpus } = require('../src/qdrant/ingest');
const { createRetrievalClient } = require('../src/qdrant/client');

const ROOT = path.join(__dirname, '..');

async function main() {
  const corpusDir = path.resolve(ROOT, config.corpus.dir);

  const client = createRetrievalClient({
    url: config.agent.qdrant.url,
    collection: config.agent.qdrant.collection,
    ollamaBaseUrl: config.agent.ollamaBaseUrl,
    embedModel: config.agent.embedModel,
  });

  const result = await ingestCorpus({
    dir: corpusDir,
    retrieval: client,
    maxChunkChars: config.corpus.maxChunkChars,
    onProgress: (line) => console.log(`[ingest] ${line}`),
  });

  console.log(
    `[ingest] done: ${result.chunks} chunks from ${result.files} files, ${result.points} points indexed`
  );

  if (result.files === 0) {
    console.log(`[ingest] ${corpusDir} holds no markdown — retrieval is now empty`);
    console.log('[ingest] add your résumé, project notes, and STAR stories, then re-run');
  }
}

main().catch((err) => {
  console.error(`[ingest] ${err.message}`);
  process.exit(1);
});
