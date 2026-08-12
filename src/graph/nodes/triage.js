'use strict';

/**
 * Phase 1 triage is heuristic only. The spec's `llama3.2:1b` fallback for
 * ambiguous utterances arrives in Phase 3; the seam for it is the final
 * `return { shouldRespond: true }` in the factory's returned function.
 */

const DEFAULT_FILLER = new Set([
  'mhm', 'mm', 'hmm', 'uh', 'uh huh', 'uhhuh', 'um', 'ah', 'oh',
  'ok', 'okay', 'yeah', 'yep', 'yes', 'no', 'right', 'sure', 'got it',
  'i see', 'makes sense', 'sounds good', 'exactly', 'cool', 'nice',
  'thank you', 'thanks', 'perfect', 'great', 'alright', 'all right',
]);

/** Strips punctuation and case so "Okay." matches "okay". */
function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {{fillerWords?: Set<string>, minWords?: number}} deps
 * @returns {(state: object) => Promise<{shouldRespond: boolean}>}
 */
function createTriage({ fillerWords = DEFAULT_FILLER, minWords = 3 } = {}) {
  return async function triage(state) {
    // The operator's own speech is recorded but never answered. Answering it
    // would make the overlay respond to the user talking to themselves.
    if (state.speaker !== 'remote') return { shouldRespond: false };

    const text = normalize(state.utterance);
    if (text.length === 0) return { shouldRespond: false };
    if (fillerWords.has(text)) return { shouldRespond: false };

    const words = text.split(' ').filter(Boolean);
    if (words.length < minWords) return { shouldRespond: false };

    return { shouldRespond: true };
  };
}

/** Conditional-edge mapper. Returns an edge label, not a node name. */
function routeAfterTriage(state) {
  return state.shouldRespond ? 'respond' : 'ignore';
}

module.exports = { createTriage, routeAfterTriage, DEFAULT_FILLER, normalize };
