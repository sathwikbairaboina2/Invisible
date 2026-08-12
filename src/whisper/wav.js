'use strict';

/** Canonical PCM WAV header: RIFF(12) + fmt (24) + data(8). */
const WAV_HEADER_BYTES = 44;
const BYTES_PER_SAMPLE = 2;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;
const FORMAT_PCM = 1;

function writeTag(view, offset, text) {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

/**
 * Encodes mono float samples as a 16-bit PCM WAV.
 *
 * whisper-server accepts an uploaded WAV directly, so this exists purely to
 * put a header on audio the pipeline already has at the right rate. Nothing
 * here touches the filesystem — the result is POSTed from memory.
 *
 * @param {Float32Array} pcm samples in [-1, 1]
 * @param {number} sampleRate
 * @returns {Uint8Array}
 */
function encodeWav(pcm, sampleRate) {
  if (!(pcm instanceof Float32Array)) {
    throw new TypeError('encodeWav: pcm must be a Float32Array');
  }

  const dataBytes = pcm.length * BYTES_PER_SAMPLE;
  const bytes = new Uint8Array(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(bytes.buffer);

  const blockAlign = CHANNELS * BYTES_PER_SAMPLE;

  writeTag(view, 0, 'RIFF');
  view.setUint32(4, WAV_HEADER_BYTES - 8 + dataBytes, true);
  writeTag(view, 8, 'WAVE');

  writeTag(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk body size
  view.setUint16(20, FORMAT_PCM, true);
  view.setUint16(22, CHANNELS, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, BITS_PER_SAMPLE, true);

  writeTag(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  for (let i = 0; i < pcm.length; i++) {
    // Clamping is not optional: a float outside [-1, 1] wraps when cast, which
    // turns a loud sample into full-scale noise of the opposite sign. Whisper
    // then transcribes the noise instead of failing visibly.
    const sample = Math.max(-1, Math.min(1, pcm[i]));
    // Asymmetric scaling because int16 spans -32768..32767.
    const value = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    view.setInt16(WAV_HEADER_BYTES + i * BYTES_PER_SAMPLE, value | 0, true);
  }

  return bytes;
}

module.exports = { encodeWav, WAV_HEADER_BYTES };
