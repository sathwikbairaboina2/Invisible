'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { AgentState, TRANSCRIPT_WINDOW } = require('../src/graph/state');
const { createTriage, routeAfterTriage } = require('../src/graph/nodes/triage');
const { buildGraph } = require('../src/graph/graph');

const triage = createTriage({});

test("the operator's own speech is never answered", async () => {
  const out = await triage({ speaker: 'user', utterance: 'What is the time complexity here?' });
  assert.equal(out.shouldRespond, false);
});

test('filler from the remote speaker is not answered', async () => {
  for (const utterance of ['mhm', 'okay', 'yeah', 'right', 'uh huh', 'sounds good']) {
    const out = await triage({ speaker: 'remote', utterance });
    assert.equal(out.shouldRespond, false, `"${utterance}" should be ignored`);
  }
});

test('a substantive remote question is answered', async () => {
  const out = await triage({
    speaker: 'remote',
    utterance: 'Can you walk me through how you would shard that table?',
  });
  assert.equal(out.shouldRespond, true);
});

test('an empty or whitespace utterance is not answered', async () => {
  assert.equal((await triage({ speaker: 'remote', utterance: '' })).shouldRespond, false);
  assert.equal((await triage({ speaker: 'remote', utterance: '   ' })).shouldRespond, false);
});

test('routeAfterTriage maps the verdict to an edge label', () => {
  assert.equal(routeAfterTriage({ shouldRespond: true }), 'respond');
  assert.equal(routeAfterTriage({ shouldRespond: false }), 'ignore');
});

test('the transcript reducer caps history at the configured window', () => {
  // LangGraph compiles an Annotation into a BinaryOperatorAggregate channel and
  // exposes the reducer as `.operator`, not `.reducer` — the latter is
  // undefined. Asserted here so a version bump that renames it fails loudly
  // instead of silently skipping this test.
  const reduce = AgentState.spec.transcript.operator;
  assert.equal(typeof reduce, 'function', 'transcript channel exposes no reducer');

  let acc = [];
  for (let i = 0; i < TRANSCRIPT_WINDOW + 10; i++) {
    acc = reduce(acc, [{ speaker: 'remote', text: `turn ${i}` }]);
  }
  assert.equal(acc.length, TRANSCRIPT_WINDOW);
  assert.equal(acc[acc.length - 1].text, `turn ${TRANSCRIPT_WINDOW + 9}`);
  assert.equal(acc[0].text, 'turn 10');
});

test('ignored utterances never reach the retriever or the generator', async () => {
  const visited = [];
  const app = buildGraph({
    transcriber: async (s) => {
      visited.push('transcriber');
      return { utterance: s.utterance, transcript: [{ speaker: s.speaker, text: s.utterance }] };
    },
    triage,
    retriever: async () => {
      visited.push('retriever');
      return { retrieved: [] };
    },
    generator: async () => {
      visited.push('generator');
      return { response: 'unreachable' };
    },
  });

  await app.invoke({ speaker: 'user', utterance: 'thinking out loud' });
  assert.deepEqual(visited, ['transcriber']);
});

test('substantive remote utterances traverse the full chain', async () => {
  const visited = [];
  const app = buildGraph({
    transcriber: async (s) => {
      visited.push('transcriber');
      return { utterance: s.utterance, transcript: [{ speaker: s.speaker, text: s.utterance }] };
    },
    triage,
    retriever: async () => {
      visited.push('retriever');
      return { retrieved: [{ text: 'context' }] };
    },
    generator: async () => {
      visited.push('generator');
      return { response: 'answer' };
    },
  });

  const out = await app.invoke({
    speaker: 'remote',
    utterance: 'How would you design a rate limiter for this API?',
  });

  assert.deepEqual(visited, ['transcriber', 'retriever', 'generator']);
  assert.equal(out.response, 'answer');
  assert.equal(out.transcript.length, 1);
});

test('buildGraph rejects a missing node', () => {
  assert.throws(
    () => buildGraph({ transcriber: async () => ({}), triage }),
    /node "retriever" must be a function/
  );
});
