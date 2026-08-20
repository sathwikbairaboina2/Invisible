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

/** Same display constraints, different job: meetings want facts and actions. */
const MEETING_SYSTEM_PROMPT = [
  'You are a silent assistant on a heads-up display during a live work meeting.',
  'The user can only glance at you between sentences.',
  '',
  'Answer in exactly this shape:',
  '- First line: the direct answer, under 12 words, no preamble.',
  '- Then 3 or 4 lines, each starting with "• ", each under 12 words.',
  '- Under 60 words total.',
  '',
  'Rules:',
  '- Short, factual, actionable. Name owners, dates, and numbers when known.',
  '- No greeting, no restating the question, no markdown headers or fences.',
  '- If you do not know, say so on the first line instead of inventing.',
].join('\n');

/** JD text is pasted wholesale; past this it crowds out the conversation. */
const JD_MAX_CHARS = 1500;

/** How the two speakers are labelled to the model. */
const SPEAKER_LABEL = { remote: 'Interviewer', user: 'You' };

/** @returns {string} extra system-prompt lines for a non-empty profile */
function profileBlock(mode, profile) {
  if (!profile) return '';
  const lines = [];
  if (mode === 'meeting') {
    if (profile.title) lines.push(`Meeting: ${profile.title}.`);
    if (profile.attendees) lines.push(`Attendees: ${profile.attendees}.`);
    if (profile.agenda) lines.push(`Agenda: ${profile.agenda}.`);
  } else {
    if (profile.role || profile.company) {
      const target = [profile.role, profile.company].filter(Boolean).join(' at ');
      lines.push(`The user is interviewing for: ${target}.`);
      lines.push('Answer as the candidate would speak, first person.');
    }
    if (profile.jobDescription) {
      lines.push(`Job description:\n${profile.jobDescription.slice(0, JD_MAX_CHARS)}`);
    }
  }
  return lines.length > 0 ? `\n\n${lines.join('\n')}` : '';
}

/**
 * Turns graph state into a messages array.
 *
 * @param {{utterance: string,
 *          transcript?: Array<{speaker: string, text: string}>,
 *          retrieved?: Array<{text: string}>,
 *          historyTurns?: number,
 *          mode?: 'interview'|'meeting',
 *          profile?: object|null}} state
 * @returns {Array<{role: 'system'|'user', content: string}>}
 */
function buildMessages({
  utterance,
  transcript = [],
  retrieved = [],
  historyTurns = 8,
  mode = 'interview',
  profile = null,
} = {}) {
  const sections = [];

  // Recent dialogue, so a follow-up like "and at scale?" resolves against what
  // came before it. Capped because the whole conversation would crowd out the
  // question actually being answered.
  const recent = transcript.slice(-historyTurns);
  if (recent.length > 0) {
    const lines = recent.map((turn) => {
      const label =
        mode === 'meeting'
          ? (turn.speaker === 'user' ? 'You' : 'Them')
          : (SPEAKER_LABEL[turn.speaker] ?? 'Interviewer');
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

  const system =
    (mode === 'meeting' ? MEETING_SYSTEM_PROMPT : SYSTEM_PROMPT) + profileBlock(mode, profile);

  return [
    { role: 'system', content: system },
    { role: 'user', content: sections.join('\n\n') },
  ];
}

module.exports = {
  buildMessages,
  SYSTEM_PROMPT,
  MEETING_SYSTEM_PROMPT,
  SPEAKER_LABEL,
  JD_MAX_CHARS,
};
