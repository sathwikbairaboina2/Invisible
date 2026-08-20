'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createMeetingLog } = require('../src/main/meeting-log');

function seededLog() {
  const log = createMeetingLog({ now: () => 1000 });
  log.addTranscript({ speaker: 'remote', text: 'How would you shard this table?' });
  log.turnStart({ turnId: 't1', speaker: 'remote', utterance: 'How would you shard this table?' });
  log.addToken('t1', 'Range-partition ');
  log.addToken('t1', 'on tenant id.');
  log.turnEnd({ turnId: 't1', aborted: false });
  log.addFollowup('t1', 'And at scale?');
  return log;
}

test('assembles a question, answer, and followup into one QA entry', () => {
  const snapshot = seededLog().snapshot();
  assert.equal(snapshot.qa.length, 1);
  const entry = snapshot.qa[0];
  assert.equal(entry.question, 'How would you shard this table?');
  assert.equal(entry.answer, 'Range-partition on tenant id.');
  assert.equal(entry.followup, 'And at scale?');
  assert.equal(entry.aborted, false);
});

test('aborted turns are marked and keep their partial answer', () => {
  const log = createMeetingLog({ now: () => 1000 });
  log.turnStart({ turnId: 't1', speaker: 'remote', utterance: 'Q?' });
  log.addToken('t1', 'Partial');
  log.turnEnd({ turnId: 't1', aborted: true });
  const entry = log.snapshot().qa[0];
  assert.equal(entry.aborted, true);
  assert.equal(entry.answer, 'Partial');
});

test('transcript lines carry timestamps and speakers', () => {
  const snapshot = seededLog().snapshot();
  assert.equal(snapshot.transcript.length, 1);
  assert.equal(snapshot.transcript[0].speaker, 'remote');
  assert.equal(snapshot.transcript[0].at, 1000);
});

test('tokens for unknown turns are ignored, not crashed on', () => {
  const log = createMeetingLog();
  log.addToken('ghost', 'x');
  log.addFollowup('ghost', 'y');
  log.turnEnd({ turnId: 'ghost', aborted: false });
  assert.equal(log.snapshot().qa.length, 0);
});

test('clear empties everything and restarts the clock', () => {
  const log = seededLog();
  log.clear();
  const snapshot = log.snapshot();
  assert.equal(snapshot.qa.length, 0);
  assert.equal(snapshot.transcript.length, 0);
});
