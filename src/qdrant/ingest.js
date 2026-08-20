'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const { chunkMarkdown } = require('./chunk');

/** Every .md under `dir`, recursively, excluding the tracked root README. */
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

/**
 * Rebuilds the retrieval collection from a corpus directory.
 *
 * Recreates rather than merges, so a file the operator deleted disappears
 * from the index — including when the corpus is empty: returning early there
 * would leave the previous index live and keep asserting stale content as
 * the operator's own. Safe to re-run after any edit.
 *
 * Shared by the CLI script and the settings window's re-index button.
 *
 * @param {{dir: string,
 *          retrieval: {ensureCollection: Function, upsertChunks: Function, probe: Function},
 *          maxChunkChars?: number,
 *          onProgress?: (line: string) => void}} options
 * @returns {Promise<{files: number, chunks: number, points: number}>}
 */
async function ingestCorpus({ dir, retrieval, maxChunkChars = 1200, onProgress } = {}) {
  if (!dir || !fs.existsSync(dir)) {
    throw new Error(`corpus directory not found: ${dir}`);
  }

  const files = await markdownFiles(dir);

  const chunks = [];
  for (const file of files) {
    const text = await fsp.readFile(file, 'utf8');
    const relative = path.relative(dir, file).replace(/\\/g, '/');
    const fileChunks = chunkMarkdown(text, { source: relative, maxChars: maxChunkChars });
    onProgress?.(`${relative}: ${fileChunks.length} chunks`);
    chunks.push(...fileChunks);
  }

  // Re-index so ids are unique across the whole corpus, not per file.
  chunks.forEach((chunk, i) => {
    chunk.index = i;
  });

  await retrieval.ensureCollection();
  await retrieval.upsertChunks(chunks);

  const probe = await retrieval.probe();
  return { files: files.length, chunks: chunks.length, points: probe.points ?? 0 };
}

module.exports = { ingestCorpus };
