'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildMessages, SYSTEM_PROMPT } = require('../src/ollama/prompt');

test('the system prompt states the answer shape it needs to enforce', () => {
  // These constraints are the entire product decision for this phase. If any
  // is dropped the model reverts to chatty prose that cannot be read while
  // the operator is speaking.
  assert.match(SYSTEM_PROMPT, /first line/i);
  assert.match(SYSTEM_PROMPT, /bullet|• /i);
  assert.match(SYSTEM_PROMPT, /•/);
  assert.match(SYSTEM_PROMPT, /no preamble|no greeting/i);
  assert.match(SYSTEM_PROMPT, /markdown/i);
});

test('emits a system message followed by a user message', () => {
  const messages = buildMessages({ utterance: 'How do you shard a table?' });

  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'system');
  assert.equal(messages[0].content, SYSTEM_PROMPT);
  assert.equal(messages[1].role, 'user');
  assert.match(messages[1].content, /How do you shard a table\?/);
});

test('includes recent dialogue so follow-up questions resolve', () => {
  // "What about the write path?" is meaningless without the turn before it.
  const messages = buildMessages({
    utterance: 'What about the write path?',
    transcript: [
      { speaker: 'remote', text: 'How would you shard a large table?' },
      { speaker: 'user', text: 'I would range-partition on tenant id.' },
      { speaker: 'remote', text: 'What about the write path?' },
    ],
  });

  const user = messages[1].content;
  assert.match(user, /range-partition on tenant id/);
  assert.match(user, /How would you shard a large table\?/);
});

test('labels who said what, so the model does not answer the operator', () => {
  const messages = buildMessages({
    utterance: 'And at scale?',
    transcript: [
      { speaker: 'remote', text: 'Explain consistent hashing.' },
      { speaker: 'user', text: 'It maps keys onto a ring.' },
    ],
  });

  const user = messages[1].content;
  assert.match(user, /Interviewer: Explain consistent hashing\./);
  assert.match(user, /You: It maps keys onto a ring\./);
});

test('caps how much dialogue is sent', () => {
  const transcript = Array.from({ length: 30 }, (_, i) => ({
    speaker: i % 2 === 0 ? 'remote' : 'user',
    text: `turn ${i}`,
  }));

  const messages = buildMessages({ utterance: 'turn 29', transcript, historyTurns: 6 });
  const user = messages[1].content;

  assert.match(user, /turn 29/);
  assert.match(user, /turn 24/);
  assert.doesNotMatch(user, /turn 23\b/, 'older turns must be dropped');
});

test('includes retrieved context when there is any', () => {
  const messages = buildMessages({
    utterance: 'Tell me about your last project.',
    retrieved: [
      { text: 'Built a CDC pipeline moving 4B rows/day from Postgres to Iceberg.' },
    ],
  });

  assert.match(messages[1].content, /CDC pipeline moving 4B rows/);
});

test('omits the context section entirely when retrieval found nothing', () => {
  // An empty "Context:" header invites the model to comment on its absence.
  const messages = buildMessages({ utterance: 'Anything else?', retrieved: [] });
  assert.doesNotMatch(messages[1].content, /context/i);
});

test('interview mode with profile names the role and company in the system prompt', () => {
  const messages = buildMessages({
    utterance: 'Why hashing?',
    mode: 'interview',
    profile: { company: 'Acme', role: 'Platform Engineer', jobDescription: 'Build rate limiters.' },
  });
  assert.equal(messages[0].role, 'system');
  assert.match(messages[0].content, /Platform Engineer/);
  assert.match(messages[0].content, /Acme/);
  assert.match(messages[0].content, /Build rate limiters\./);
});

test('meeting mode uses the meeting system prompt with title and agenda', () => {
  const messages = buildMessages({
    utterance: 'What did we decide?',
    mode: 'meeting',
    profile: { title: 'Q3 planning', attendees: 'Ana, Raj', agenda: 'Budget review' },
  });
  assert.match(messages[0].content, /Q3 planning/);
  assert.match(messages[0].content, /Ana, Raj/);
  assert.match(messages[0].content, /Budget review/);
  assert.doesNotMatch(messages[0].content, /interview/i);
});

test('empty profile falls back to the generic prompts', () => {
  const generic = buildMessages({ utterance: 'Q' });
  const withEmpty = buildMessages({ utterance: 'Q', mode: 'interview', profile: {
    company: '', role: '', jobDescription: '', title: '', attendees: '', agenda: '',
  }});
  assert.equal(withEmpty[0].content, generic[0].content);
});

test('job description is truncated to the cap', () => {
  const long = 'x'.repeat(5000);
  const messages = buildMessages({
    utterance: 'Q',
    mode: 'interview',
    profile: { company: 'A', role: 'B', jobDescription: long },
  });
  assert.ok(messages[0].content.length < 3000, 'JD must be truncated, not embedded whole');
});

test('meeting mode labels speakers neutrally', () => {
  const messages = buildMessages({
    utterance: 'And next steps?',
    mode: 'meeting',
    transcript: [
      { speaker: 'remote', text: 'Budget is frozen.' },
      { speaker: 'user', text: 'Understood.' },
    ],
  });
  assert.match(messages[1].content, /Them: Budget is frozen\./);
  assert.match(messages[1].content, /You: Understood\./);
});

test('marks the current question distinctly from history', () => {
  const messages = buildMessages({
    utterance: 'Why not use a queue?',
    transcript: [{ speaker: 'remote', text: 'Why not use a queue?' }],
  });

  // The model must know which line it is answering, not just that it exists.
  assert.match(messages[1].content, /Answer this[\s\S]*Why not use a queue\?/i);
});
