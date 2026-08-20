'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseExport, renderReplay } = require('../src/main/replay');

const EXPORT_MD = `# Invisible — interview notes

- Date: 8/20/2026, 8:05:48 PM
- Questions answered: 2

## Drill these

- Why not hash?

## Questions & answers

### How would you shard this table?

Range-partition on tenant id.

> predicted follow-up: And at scale?

### Why not hash?

Partial *(interrupted)*

## Transcript

- 00:04 **them**: How would you shard this table?
`;

test('parses questions and given answers out of an export', () => {
  const entries = parseExport(EXPORT_MD);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].question, 'How would you shard this table?');
  assert.equal(entries[0].answer, 'Range-partition on tenant id.');
  assert.equal(entries[1].question, 'Why not hash?');
  assert.match(entries[1].answer, /Partial/);
});

test('followup quotes and later sections do not leak into answers', () => {
  const entries = parseExport(EXPORT_MD);
  assert.doesNotMatch(entries[0].answer, /predicted follow-up/);
  assert.doesNotMatch(entries[1].answer, /Transcript/);
});

test('an export with no QA section parses to an empty list', () => {
  assert.deepEqual(parseExport('# Invisible — meeting notes\n\n## Transcript\n'), []);
});

test('renderReplay pairs what was said with the rehearsed answer', () => {
  const md = renderReplay([
    {
      question: 'Why not hash?',
      answer: 'Partial',
      better: 'Hash sharding complicates range scans; tenant ranges match access patterns.',
    },
  ]);
  assert.match(md, /^# Invisible — practice replay/m);
  assert.match(md, /## Why not hash\?/);
  assert.match(md, /\*\*You said:\*\*[\s\S]*Partial/);
  assert.match(md, /\*\*Rehearsed answer:\*\*[\s\S]*range scans/);
});
