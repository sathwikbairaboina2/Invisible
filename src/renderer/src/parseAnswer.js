'use strict';

/** Bullet markers the model actually emits, despite being asked for "• ". */
const BULLET = /^\s*[•\-*–·]\s+/;

/** Emphasis the prompt forbids but a model will occasionally produce anyway. */
function stripEmphasis(line) {
  return line
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(^|\s)\*(?!\s)(.+?)\*(?=\s|$)/g, '$1$2')
    .replace(/^#+\s*/, '')
    .trim();
}

/**
 * Splits an answer into its lead line and bullets.
 *
 * Called on every streamed token, so it must be cheap and must never throw on
 * a half-written line.
 *
 * @param {string} text
 * @returns {{lead: string, bullets: string[]}}
 */
function parseAnswer(text) {
  const lines = String(text ?? '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) return { lead: '', bullets: [] };

  const bullets = [];
  let lead = '';

  for (const line of lines) {
    if (BULLET.test(line)) {
      bullets.push(stripEmphasis(line.replace(BULLET, '')));
    } else if (!lead) {
      lead = stripEmphasis(line);
    } else {
      // A second non-bullet line is continuation prose; fold it into the lead
      // rather than dropping it.
      lead = `${lead} ${stripEmphasis(line)}`.trim();
    }
  }

  // A model that skipped the lead line should not render an empty slot above
  // its bullets.
  if (!lead && bullets.length > 0) {
    lead = bullets.shift();
  }

  return { lead, bullets };
}

module.exports = { parseAnswer };
