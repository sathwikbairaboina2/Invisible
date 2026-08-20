'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { effectiveAudio } = require('../src/main/audio-config');
const config = require('../src/main/config');

const merged = (redemptionMs = config.audio.vad.redemptionMs) => ({
  ...config.audio,
  vad: { ...config.audio.vad, redemptionMs },
});

test('interview mode raises the redemption window to the mode value', () => {
  const audio = effectiveAudio(merged(), 'interview');
  assert.equal(audio.vad.redemptionMs, config.audio.vad.redemptionMsByMode.interview);
});

test('meeting mode uses the meeting value', () => {
  const audio = effectiveAudio(merged(), 'meeting');
  assert.equal(audio.vad.redemptionMs, config.audio.vad.redemptionMsByMode.meeting);
});

test('an explicit operator override beats the mode value', () => {
  const audio = effectiveAudio(merged(512), 'interview');
  assert.equal(audio.vad.redemptionMs, 512);
});

test('unknown mode falls back to the configured base value', () => {
  const audio = effectiveAudio(merged(), undefined);
  assert.equal(audio.vad.redemptionMs, config.audio.vad.redemptionMs);
});

test('other audio fields pass through untouched', () => {
  const audio = effectiveAudio(merged(), 'interview');
  assert.equal(audio.sampleRate, config.audio.sampleRate);
  assert.equal(audio.vad.minSpeechMs, config.audio.vad.minSpeechMs);
});
