'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { audioChanged } = require('../src/main/audio-diff');

const base = () => ({
  audio: { sampleRate: 16000, vad: { redemptionMs: 384, minSpeechMs: 192 } },
  agent: { temperature: 0.2 },
});

test('detects a VAD change', () => {
  const before = base();
  const after = base();
  after.audio.vad.redemptionMs = 640;
  assert.equal(audioChanged(before, after), true);
});

test('ignores non-audio changes', () => {
  const before = base();
  const after = base();
  after.agent.temperature = 0.7;
  assert.equal(audioChanged(before, after), false);
});

test('identical settings are not a change', () => {
  assert.equal(audioChanged(base(), base()), false);
});

test('missing audio subtree on either side is not a change', () => {
  assert.equal(audioChanged({}, {}), false);
});
