'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { renderExport } = require('../src/main/export');

const SNAPSHOT = {
  startedAt: new Date('2026-08-20T12:00:00Z').getTime(),
  transcript: [
    { speaker: 'remote', text: 'How would you shard this table?', at: 0 },
    { speaker: 'user', text: 'Range partition on tenant id.', at: 0 },
  ],
  qa: [
    {
      question: 'How would you shard this table?',
      answer: 'Range-partition on tenant id.',
      followup: 'And at scale?',
      aborted: false,
    },
    { question: 'Why not hash?', answer: 'Partial', followup: '', aborted: true },
  ],
};

test('renders header, summary, QA, and transcript sections', () => {
  const md = renderExport({
    snapshot: SNAPSHOT,
    session: { mode: 'meeting', profile: { title: 'Q3 planning', attendees: 'Ana', agenda: '' } },
    summary: 'Budget frozen until October.',
  });
  assert.match(md, /^# Invisible — meeting notes/m);
  assert.match(md, /Q3 planning/);
  assert.match(md, /## Earlier summary\n+Budget frozen until October\./);
  assert.match(md, /## Questions & answers/);
  assert.match(md, /How would you shard this table\?/);
  assert.match(md, /Range-partition on tenant id\./);
  assert.match(md, /And at scale\?/);
  assert.match(md, /## Transcript/);
  assert.match(md, /\*\*them\*\*: How would you shard this table\?/);
});

test('empty summary and empty QA sections are omitted', () => {
  const md = renderExport({
    snapshot: { ...SNAPSHOT, qa: [] },
    session: { mode: 'meeting', profile: {} },
    summary: '',
  });
  assert.doesNotMatch(md, /## Earlier summary/);
  assert.doesNotMatch(md, /## Questions & answers/);
});

test('interview mode adds a drill list of aborted or unanswered questions', () => {
  const md = renderExport({
    snapshot: SNAPSHOT,
    session: { mode: 'interview', profile: { company: 'Acme', role: 'SRE', jobDescription: '' } },
    summary: '',
  });
  assert.match(md, /# Invisible — interview notes/);
  assert.match(md, /SRE at Acme/);
  // The drill section must contain exactly the one flunked question.
  assert.match(md, /## Drill these\n\n- Why not hash\?\n\n## /);
});
