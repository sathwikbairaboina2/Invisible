'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { chunkMarkdown } = require('../src/qdrant/chunk');

test('splits on markdown headings, one chunk per section', () => {
  const chunks = chunkMarkdown(
    [
      '## Rate limiter project',
      'Built a token bucket over Redis.',
      '',
      '## CDC pipeline',
      'Moved 4B rows a day from Postgres to Iceberg.',
    ].join('\n'),
    { source: 'projects.md' }
  );

  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].heading, 'Rate limiter project');
  assert.match(chunks[0].text, /token bucket over Redis/);
  assert.equal(chunks[1].heading, 'CDC pipeline');
  assert.match(chunks[1].text, /4B rows a day/);
});

test('keeps the heading inside the chunk text', () => {
  // The heading is often the most retrievable part: "Rate limiter project"
  // matches a question about rate limiting far better than the body prose.
  const chunks = chunkMarkdown('## Sharding war story\nWe range-partitioned.', {
    source: 's.md',
  });

  assert.match(chunks[0].text, /Sharding war story/);
  assert.match(chunks[0].text, /range-partitioned/);
});

test('handles all heading levels', () => {
  const chunks = chunkMarkdown(
    ['# Top', 'a', '## Middle', 'b', '### Deep', 'c'].join('\n'),
    { source: 's.md' }
  );

  assert.deepEqual(
    chunks.map((c) => c.heading),
    ['Top', 'Middle', 'Deep']
  );
});

test('keeps content that appears before any heading', () => {
  // A file that opens with prose must not silently lose it.
  const chunks = chunkMarkdown('Intro paragraph with no heading.\n\n## After\nbody', {
    source: 's.md',
  });

  assert.equal(chunks.length, 2);
  assert.match(chunks[0].text, /Intro paragraph/);
  assert.equal(chunks[0].heading, '');
});

test('splits an oversized section on paragraph boundaries', () => {
  const para = 'x'.repeat(400);
  const chunks = chunkMarkdown(`## Long\n${para}\n\n${para}\n\n${para}\n\n${para}`, {
    source: 's.md',
    maxChars: 900,
  });

  assert.ok(chunks.length > 1, 'an oversized section should split');
  for (const chunk of chunks) {
    assert.ok(chunk.text.length <= 900 + 20, `chunk of ${chunk.text.length} exceeds the cap`);
  }
});

test('repeats the heading on every fragment of a split section', () => {
  // Without this, fragment two is an anonymous wall of text with no clue what
  // it is about, and it retrieves for nothing.
  const para = 'y'.repeat(500);
  const chunks = chunkMarkdown(`## Postgres migration\n${para}\n\n${para}`, {
    source: 's.md',
    maxChars: 700,
  });

  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.match(chunk.text, /Postgres migration/);
    assert.equal(chunk.heading, 'Postgres migration');
  }
});

test('drops empty and whitespace-only sections', () => {
  const chunks = chunkMarkdown('## Empty\n\n   \n\n## Real\ncontent here', { source: 's.md' });

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].heading, 'Real');
});

test('stamps every chunk with its source and a stable index', () => {
  const chunks = chunkMarkdown('## A\nalpha\n\n## B\nbravo', { source: 'stories.md' });

  assert.deepEqual(
    chunks.map((c) => [c.source, c.index]),
    [
      ['stories.md', 0],
      ['stories.md', 1],
    ]
  );
});

test('returns nothing for an empty document', () => {
  assert.deepEqual(chunkMarkdown('', { source: 's.md' }), []);
  assert.deepEqual(chunkMarkdown('   \n\n  ', { source: 's.md' }), []);
});
