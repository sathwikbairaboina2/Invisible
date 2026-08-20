'use strict';

/**
 * True when two merged-settings snapshots differ anywhere under `audio`.
 *
 * JSON stringify is a legitimate deep-equal here: the audio subtree is plain
 * data from config.js merged with JSON overrides, so key order is stable and
 * there is nothing non-serialisable in it.
 */
function audioChanged(before, after) {
  return JSON.stringify(before?.audio ?? null) !== JSON.stringify(after?.audio ?? null);
}

module.exports = { audioChanged };
