'use strict';

/** Matches an ATX heading and captures its text. */
const HEADING = /^(#{1,6})\s+(.*)$/;

/**
 * Splits markdown into embeddable chunks, one per heading section.
 *
 * Heading-based rather than fixed-size because of what this corpus holds: a
 * STAR story or a single job on a résumé is a coherent unit, and cutting one in
 * half mid-sentence produces two fragments that each retrieve badly. Sections
 * over `maxChars` are split again on paragraph boundaries rather than mid-word.
 *
 * @param {string} text
 * @param {{source?: string, maxChars?: number}} options
 * @returns {Array<{text: string, heading: string, source: string, index: number}>}
 */
function chunkMarkdown(text, { source = '', maxChars = 1200 } = {}) {
  const lines = String(text ?? '').split(/\r?\n/);

  /** @type {Array<{heading: string, body: string[]}>} */
  const sections = [];
  let current = { heading: '', body: [] };

  for (const line of lines) {
    const match = HEADING.exec(line);
    if (match) {
      sections.push(current);
      current = { heading: match[2].trim(), body: [] };
    } else {
      current.body.push(line);
    }
  }
  sections.push(current);

  const chunks = [];

  for (const section of sections) {
    const body = section.body.join('\n').trim();
    // A heading with no body is a table of contents entry, not a fact.
    if (body.length === 0) continue;

    for (const fragment of splitToFit(body, section.heading, maxChars)) {
      chunks.push({
        // The heading is prepended to the embedded text because it is often the
        // most retrievable part: "Rate limiter project" matches a question
        // about rate limiting better than the body prose does.
        text: section.heading ? `${section.heading}\n${fragment}` : fragment,
        heading: section.heading,
        source,
        index: chunks.length,
      });
    }
  }

  return chunks;
}

/**
 * Splits a section body into pieces that fit under `maxChars`, accounting for
 * the heading that will be prepended to each.
 *
 * @returns {string[]}
 */
function splitToFit(body, heading, maxChars) {
  const budget = Math.max(1, maxChars - heading.length - 1);
  if (body.length <= budget) return [body];

  const paragraphs = body.split(/\n{2,}/);
  const fragments = [];
  let buffer = '';

  for (const paragraph of paragraphs) {
    const candidate = buffer ? `${buffer}\n\n${paragraph}` : paragraph;

    if (candidate.length <= budget) {
      buffer = candidate;
      continue;
    }

    if (buffer) fragments.push(buffer);

    // A single paragraph longer than the budget still has to go somewhere; a
    // hard split is ugly but beats dropping the content silently.
    if (paragraph.length > budget) {
      for (let i = 0; i < paragraph.length; i += budget) {
        fragments.push(paragraph.slice(i, i + budget));
      }
      buffer = '';
    } else {
      buffer = paragraph;
    }
  }

  if (buffer) fragments.push(buffer);
  return fragments;
}

module.exports = { chunkMarkdown };
