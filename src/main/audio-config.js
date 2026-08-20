'use strict';

const config = require('./config');

/**
 * The audio config a capture chain should actually run with, given the mode.
 *
 * Precedence for redemptionMs: an explicit operator override (the merged
 * value differs from the config default) wins, then the mode's entry in
 * redemptionMsByMode, then the base value. The comparison against the default
 * means an operator who sets the slider to exactly the default value is
 * treated as not overriding — acceptable, since that is what "default" means.
 *
 * @param {object} mergedAudio settings.get().audio
 * @param {'interview'|'meeting'|undefined} mode
 * @returns {object} audio config with the resolved redemptionMs
 */
function effectiveAudio(mergedAudio, mode) {
  const base = config.audio.vad.redemptionMs;
  const byMode = config.audio.vad.redemptionMsByMode ?? {};

  const overridden = mergedAudio?.vad?.redemptionMs !== base;
  const redemptionMs = overridden
    ? mergedAudio.vad.redemptionMs
    : (byMode[mode] ?? base);

  return {
    ...mergedAudio,
    vad: { ...mergedAudio?.vad, redemptionMs },
  };
}

module.exports = { effectiveAudio };
