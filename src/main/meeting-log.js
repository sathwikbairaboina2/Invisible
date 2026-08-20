'use strict';

/**
 * In-memory record of one meeting: timestamped transcript lines and
 * question/answer pairs assembled from the turn lifecycle events main
 * already receives. Feeds the markdown export; wiped by panic and clear,
 * because panic means wipe.
 *
 * @param {{now?: () => number}} deps injectable clock for tests
 */
function createMeetingLog({ now = Date.now } = {}) {
  let startedAt = now();
  /** @type {Array<{speaker: string, text: string, at: number}>} */
  let transcript = [];
  /** Completed QA entries, in turn order. */
  let qa = [];
  /** Open turns, keyed by turnId. */
  const open = new Map();

  return {
    addTranscript(segment) {
      if (!segment?.text) return;
      transcript.push({ speaker: segment.speaker ?? 'remote', text: segment.text, at: now() });
    },

    turnStart({ turnId, utterance } = {}) {
      if (!turnId) return;
      open.set(turnId, { question: utterance ?? '', answer: '', followup: '', at: now() });
    },

    addToken(turnId, token) {
      const entry = open.get(turnId);
      if (entry) entry.answer += token;
    },

    turnEnd({ turnId, aborted } = {}) {
      const entry = open.get(turnId);
      if (!entry) return;
      // Kept in `open` as well: the followup for this turn arrives after end.
      entry.aborted = Boolean(aborted);
      qa.push(entry);
    },

    addFollowup(turnId, text) {
      const entry = open.get(turnId);
      if (entry) entry.followup = text;
    },

    snapshot() {
      return { startedAt, transcript: [...transcript], qa: qa.map((entry) => ({ ...entry })) };
    },

    clear() {
      startedAt = now();
      transcript = [];
      qa = [];
      open.clear();
    },
  };
}

module.exports = { createMeetingLog };
