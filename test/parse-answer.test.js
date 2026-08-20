'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseAnswer } = require('../src/renderer/src/parseAnswer.js');

test('extracts a fenced code block from a code answer', () => {
  const parsed = parseAnswer(
    [
      'Two-pointer reversal.',
      '```python',
      'def reverse(head):',
      '    prev = None',
      '    return prev',
      '```',
      '• O(n) time, O(1) space.',
    ].join('\n')
  );
  assert.equal(parsed.lead, 'Two-pointer reversal.');
  assert.equal(parsed.code, 'def reverse(head):\n    prev = None\n    return prev');
  assert.deepEqual(parsed.bullets, ['O(n) time, O(1) space.']);
});

test('an unterminated fence mid-stream treats the tail as code', () => {
  const parsed = parseAnswer(['Lead.', '```js', 'const x ='].join('\n'));
  assert.equal(parsed.lead, 'Lead.');
  assert.equal(parsed.code, 'const x =');
});

test('answers without fences have empty code', () => {
  const parsed = parseAnswer('Just a line.');
  assert.equal(parsed.code, '');
});

test('splits a well-formed answer into lead and bullets', () => {
  const parsed = parseAnswer(
    [
      'Token bucket, Redis-backed.',
      '• Sliding window is smoother.',
      '• Fail open on Redis down.',
    ].join('\n')
  );

  assert.equal(parsed.lead, 'Token bucket, Redis-backed.');
  assert.deepEqual(parsed.bullets, ['Sliding window is smoother.', 'Fail open on Redis down.']);
});

test('accepts the bullet characters a model actually emits', () => {
  // Prompted for "• " but models drift to hyphens, asterisks, and en dashes.
  const parsed = parseAnswer(['Lead line.', '- first', '* second', '– third', '· fourth'].join('\n'));
  assert.deepEqual(parsed.bullets, ['first', 'second', 'third', 'fourth']);
});

test('strips markdown emphasis the prompt forbade but the model used anyway', () => {
  const parsed = parseAnswer(['**Use a token bucket.**', '• Use `INCR` and `EXPIRE`.'].join('\n'));
  assert.equal(parsed.lead, 'Use a token bucket.');
  assert.deepEqual(parsed.bullets, ['Use `INCR` and `EXPIRE`.']);
});

test('treats a lead-only answer as having no bullets', () => {
  const parsed = parseAnswer('O(n log n) average case.');
  assert.equal(parsed.lead, 'O(n log n) average case.');
  assert.deepEqual(parsed.bullets, []);
});

test('ignores blank lines between the lead and the bullets', () => {
  const parsed = parseAnswer('Lead.\n\n\n• one\n\n• two');
  assert.equal(parsed.lead, 'Lead.');
  assert.deepEqual(parsed.bullets, ['one', 'two']);
});

test('handles a partial stream where the lead is still arriving', () => {
  // Called on every token, so it must never throw mid-word.
  assert.deepEqual(parseAnswer('Tok'), { lead: 'Tok', bullets: [], code: '' });
  assert.deepEqual(parseAnswer(''), { lead: '', bullets: [], code: '' });
  assert.deepEqual(parseAnswer('Lead.\n• par'), { lead: 'Lead.', bullets: ['par'], code: '' });
});

test('promotes a leading bullet when the model skips the lead line', () => {
  // Better to show the first point as the lead than to render an empty lead
  // slot above the bullets.
  const parsed = parseAnswer('• first point\n• second point');
  assert.equal(parsed.lead, 'first point');
  assert.deepEqual(parsed.bullets, ['second point']);
});
