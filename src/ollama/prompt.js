'use strict';

/**
 * The operator reads this while talking. That single fact drives every rule
 * below: length, shape, and the ban on preamble. Prose cannot be read while
 * speaking, and a model that opens with "Great question!" has spent the
 * operator's entire attention budget before saying anything.
 */
const SYSTEM_PROMPT = [
  'You are a silent assistant on a heads-up display during a live technical interview.',
  'The user is being interviewed right now and can only glance at you between sentences.',
  '',
  'Answer in exactly this shape:',
  '- First line: the direct answer, under 12 words, no preamble.',
  '- Then 3 or 4 lines, each starting with "• ", each under 12 words.',
  '- Under 60 words total.',
  '',
  'Rules:',
  '- No greeting, no "Great question", no restating the question.',
  '- No markdown headers, no bold, no code fences.',
  '- Name the actual algorithm, API, or trade-off. Concrete nouns beat hedging.',
  '- If code is genuinely needed, one short inline line, no fences.',
  '- If you do not know, say so on the first line instead of inventing.',
].join('\n');

/** How the two speakers are labelled to the model. */
const SPEAKER_LABEL = { remote: 'Interviewer', user: 'You' };

/**
 * Turns graph state into a messages array.
 *
 * @param {{utterance: string,
 *          transcript?: Array<{speaker: string, text: string}>,
 *          retrieved?: Array<{text: string}>,
 *          historyTurns?: number}} state
 * @returns {Array<{role: 'system'|'user', content: string}>}
 */
function buildMessages({ utterance, transcript = [], retrieved = [], historyTurns = 8 } = {}) {
  const sections = [];

  // Recent dialogue, so a follow-up like "and at scale?" resolves against what
  // came before it. Capped because the whole conversation would crowd out the
  // question actually being answered.
  const recent = transcript.slice(-historyTurns);
  if (recent.length > 0) {
    const lines = recent.map((turn) => {
      const label = SPEAKER_LABEL[turn.speaker] ?? 'Interviewer';
      return `${label}: ${turn.text}`;
    });
    sections.push(`Conversation so far:\n${lines.join('\n')}`);
  }

  // Only emitted when non-empty: an empty "Context:" header invites the model
  // to remark on having no context, which wastes the operator's first line.
  const context = retrieved.filter((hit) => hit?.text).map((hit) => `- ${hit.text}`);
  if (context.length > 0) {
    sections.push(`Context about the user:\n${context.join('\n')}`);
  }

  sections.push(`Answer this, in the shape described:\n${utterance}`);

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: sections.join('\n\n') },
  ];
}

module.exports = { buildMessages, SYSTEM_PROMPT, SPEAKER_LABEL };
