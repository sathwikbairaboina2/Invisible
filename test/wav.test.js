'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { encodeWav, WAV_HEADER_BYTES } = require('../src/whisper/wav');

/** Reads a 4-character ASCII tag at `offset`. */
function tag(bytes, offset) {
  return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}

function view(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

test('emits a canonical RIFF/WAVE header', () => {
  const wav = encodeWav(new Float32Array(4), 16000);
  const dv = view(wav);

  assert.equal(tag(wav, 0), 'RIFF');
  assert.equal(tag(wav, 8), 'WAVE');
  assert.equal(tag(wav, 12), 'fmt ');
  assert.equal(tag(wav, 36), 'data');

  assert.equal(dv.getUint32(16, true), 16, 'fmt chunk size');
  assert.equal(dv.getUint16(20, true), 1, 'PCM format tag');
  assert.equal(dv.getUint16(22, true), 1, 'mono');
  assert.equal(dv.getUint32(24, true), 16000, 'sample rate');
  assert.equal(dv.getUint16(34, true), 16, 'bits per sample');
});

test('header arithmetic is self-consistent', () => {
  const samples = 100;
  const wav = encodeWav(new Float32Array(samples), 16000);
  const dv = view(wav);

  const dataBytes = samples * 2;
  assert.equal(wav.length, WAV_HEADER_BYTES + dataBytes);
  assert.equal(dv.getUint32(4, true), wav.length - 8, 'RIFF size excludes the first 8 bytes');
  assert.equal(dv.getUint32(40, true), dataBytes, 'data chunk size');
  assert.equal(dv.getUint32(28, true), 16000 * 2, 'byte rate = rate * blockAlign');
  assert.equal(dv.getUint16(32, true), 2, 'block align = channels * bytesPerSample');
});

test('converts float samples to signed 16-bit', () => {
  const wav = encodeWav(Float32Array.from([0, 1, -1, 0.5]), 16000);
  const dv = view(wav);

  assert.equal(dv.getInt16(WAV_HEADER_BYTES + 0, true), 0);
  assert.equal(dv.getInt16(WAV_HEADER_BYTES + 2, true), 32767, 'full positive scale');
  assert.equal(dv.getInt16(WAV_HEADER_BYTES + 4, true), -32768, 'full negative scale');
  assert.equal(dv.getInt16(WAV_HEADER_BYTES + 6, true), 16383, '0.5 * 32767 truncated');
});

test('clamps samples outside [-1, 1] instead of wrapping', () => {
  // Without clamping these wrap around and become loud noise, which whisper
  // transcribes as garbage rather than failing visibly.
  const wav = encodeWav(Float32Array.from([2, -2, 1.0001, -1.0001]), 16000);
  const dv = view(wav);

  assert.equal(dv.getInt16(WAV_HEADER_BYTES + 0, true), 32767);
  assert.equal(dv.getInt16(WAV_HEADER_BYTES + 2, true), -32768);
  assert.equal(dv.getInt16(WAV_HEADER_BYTES + 4, true), 32767);
  assert.equal(dv.getInt16(WAV_HEADER_BYTES + 6, true), -32768);
});

test('handles an empty utterance without throwing', () => {
  const wav = encodeWav(new Float32Array(0), 16000);
  assert.equal(wav.length, WAV_HEADER_BYTES);
  assert.equal(view(wav).getUint32(40, true), 0);
});

test('rejects a missing or wrongly-typed buffer', () => {
  assert.throws(() => encodeWav(null, 16000), /Float32Array/);
  assert.throws(() => encodeWav([0, 1], 16000), /Float32Array/);
});
