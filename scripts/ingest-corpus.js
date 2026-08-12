'use strict';

/**
 * Rebuilds the retrieval collection from the corpus directory.
 *
 * Recreates rather than merges, so a file the operator deleted disappears from
 * the index. Safe to re-run after any edit.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const config = require('../src/main/config');
const { chunkMarkdown } = require('../src/qdrant/chunk');
const { createRetrievalClient } = require('../src/qdrant/client');

const ROOT = path.join(__dirname, '..');

/** Every .md under `dir`, recursively, excluding the tracked README. */
async function markdownFiles(dir) {
  const found = [];

  async function walk(current) {
    let entries;
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.name.toLowerCase().endsWith('.md')) {
        if (path.relative(dir, full).toLowerCase() === 'readme.md') continue;
        found.push(full);
      }
    }
  }

  await walk(dir);
  return found;
}

async function main() {
  const corpusDir = path.resolve(ROOT, config.corpus.dir);

  if (!fs.existsSync(corpusDir)) {
    throw new Error(`corpus directory not found: ${corpusDir}`);
  }

  const files = await markdownFiles(corpusDir);

  const chunks = [];
  for (const file of files) {
    const text = await fsp.readFile(file, 'utf8');
    const relative = path.relative(corpusDir, file).replace(/\\/g, '/');
    const fileChunks = chunkMarkdown(text, {
      source: relative,
      maxChars: config.corpus.maxChunkChars,
    });
    console.log(`[ingest] ${relative}: ${fileChunks.length} chunks`);
    chunks.push(...fileChunks);
  }

  // Re-index so ids are unique across the whole corpus, not per file.
  chunks.forEach((chunk, i) => {
    chunk.index = i;
  });

  const client = createRetrievalClient({
    url: config.agent.qdrant.url,
    collection: config.agent.qdrant.collection,
    ollamaBaseUrl: config.agent.ollamaBaseUrl,
    embedModel: config.agent.embedModel,
  });

  // Recreated even when the corpus is empty. Returning early here would leave
  // the previous index live, so emptying corpus/ would look like it cleared
  // retrieval while the old content kept being retrieved and asserted as the
  // operator's own. The index must match the corpus, including when the corpus
  // is nothing.
  const size = await client.ensureCollection();
  console.log(
    `[ingest] collection ${config.agent.qdrant.collection} recreated, vector size ${size}`
  );

  await client.upsertChunks(chunks);

  const result = await client.probe();
  console.log(
    `[ingest] done: ${chunks.length} chunks from ${files.length} files, ${result.points} points indexed`
  );

  if (files.length === 0) {
    console.log(`[ingest] ${corpusDir} holds no markdown — retrieval is now empty`);
    console.log('[ingest] add your résumé, project notes, and STAR stories, then re-run');
  }
}

main().catch((err) => {
  console.error(`[ingest] ${err.message}`);
  process.exit(1);
});
