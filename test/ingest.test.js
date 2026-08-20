'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ingestCorpus } = require('../src/qdrant/ingest');

function tempCorpus(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'invisible-corpus-'));
  for (const [name, text] of Object.entries(files)) {
    const full = path.join(dir, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text, 'utf8');
  }
  return dir;
}

function fakeRetrieval() {
  const calls = { ensured: 0, upserted: null };
  return {
    calls,
    ensureCollection: async () => {
      calls.ensured += 1;
      return 768;
    },
    upsertChunks: async (chunks) => {
      calls.upserted = chunks;
    },
    probe: async () => ({ ok: true, exists: true, points: calls.upserted?.length ?? 0 }),
  };
}

test('ingests markdown files recursively and reports counts', async () => {
  const dir = tempCorpus({
    'resume.md': '# Resume\n\nBuilt a CDC pipeline.',
    'notes/star.md': '# Story\n\nLed the migration.',
  });
  const retrieval = fakeRetrieval();

  const result = await ingestCorpus({ dir, retrieval });

  assert.equal(result.files, 2);
  assert.ok(result.chunks >= 2);
  assert.equal(result.points, result.chunks);
  assert.equal(retrieval.calls.ensured, 1, 'collection recreated exactly once');
  assert.equal(retrieval.calls.upserted.length, result.chunks);
});

test('chunk ids are unique across files', async () => {
  const dir = tempCorpus({
    'a.md': '# A\n\none',
    'b.md': '# B\n\ntwo',
  });
  const retrieval = fakeRetrieval();

  await ingestCorpus({ dir, retrieval });

  const ids = retrieval.calls.upserted.map((chunk) => chunk.index);
  assert.equal(new Set(ids).size, ids.length);
});

test('README.md at the corpus root is skipped', async () => {
  const dir = tempCorpus({
    'README.md': '# How to use this directory',
    'real.md': '# Real\n\ncontent',
  });
  const retrieval = fakeRetrieval();

  const result = await ingestCorpus({ dir, retrieval });

  assert.equal(result.files, 1);
});

test('an empty corpus still recreates the collection', async () => {
  const dir = tempCorpus({});
  const retrieval = fakeRetrieval();

  const result = await ingestCorpus({ dir, retrieval });

  assert.equal(result.files, 0);
  assert.equal(result.chunks, 0);
  assert.equal(retrieval.calls.ensured, 1);
});

test('a missing directory throws a readable error', async () => {
  const retrieval = fakeRetrieval();
  await assert.rejects(
    () => ingestCorpus({ dir: path.join(os.tmpdir(), 'does-not-exist-xyz'), retrieval }),
    /corpus directory not found/
  );
});
