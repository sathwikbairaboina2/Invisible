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

test('getSession snapshot reaches the generator state', async () => {
  let seen = null;
  const runtime = createAgentRuntime({
    transcribe: async () => 'question text',
    getSession: () => ({ mode: 'interview', profile: { company: 'Acme' } }),
    stream: async function* (state) {
      seen = { mode: state.mode, profile: state.profile };
      yield 'x';
    },
  });

  await runtime.ask('why?');

  assert.equal(seen.mode, 'interview');
  assert.equal(seen.profile.company, 'Acme');
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

test('forceRespond bypasses triage entirely', async () => {
  // The manual-ask shortcut must reach the generator even for an utterance
  // triage would otherwise discard as filler.
  const out = await triage({ speaker: 'remote', utterance: 'okay', forceRespond: true });
  assert.equal(out.shouldRespond, true);
});

// ---------------------------------------------------------------------------
// Agent runtime
// ---------------------------------------------------------------------------

const { createAgentRuntime } = require('../src/graph/graph');

/** Minimal stand-in for config.agent. */
const TEST_CONFIG = { transcriptWindow: 40 };

function collector() {
  const events = { starts: [], tokens: [], ends: [], transcripts: [], errors: [] };
  return {
    events,
    handlers: {
      config: TEST_CONFIG,
      onTurnStart: (t) => events.starts.push(t),
      onToken: (turnId, token) => events.tokens.push({ turnId, token }),
      onTurnEnd: (t) => events.ends.push(t),
      onTranscriptFinal: (s) => events.transcripts.push(s),
      onTranscriptPartial: () => {},
      onError: (e) => events.errors.push(e),
    },
  };
}

const silence = () => new Float32Array(16000);

/** Polls until `predicate` holds, so tests do not race a timed token stream. */
async function waitFor(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test('a remote utterance produces a streamed turn', async () => {
  const { events, handlers } = collector();
  const runtime = createAgentRuntime(handlers);

  await runtime.submitUtterance({
    speaker: 'remote',
    pcm: silence(),
    sampleRate: 16000,
    durationMs: 1000,
  });

  assert.equal(events.starts.length, 1);
  assert.ok(events.tokens.length > 1, 'expected more than one token');
  assert.equal(events.ends.length, 1);
  assert.equal(events.ends[0].aborted, false);
  assert.equal(events.tokens[0].turnId, events.starts[0].turnId);
  assert.equal(events.errors.length, 0);

  runtime.dispose();
});

test("the operator's own speech produces transcript but no turn", async () => {
  const { events, handlers } = collector();
  const runtime = createAgentRuntime(handlers);

  await runtime.submitUtterance({
    speaker: 'user',
    pcm: silence(),
    sampleRate: 16000,
    durationMs: 1000,
  });

  assert.equal(events.transcripts.length, 1);
  assert.equal(events.transcripts[0].speaker, 'user');
  assert.equal(events.starts.length, 0);
  assert.equal(events.tokens.length, 0);

  runtime.dispose();
});

test('cancel mid-stream ends the turn as aborted and truncates it', async () => {
  const { events, handlers } = collector();
  const runtime = createAgentRuntime(handlers);

  const pending = runtime.submitUtterance({
    speaker: 'remote',
    pcm: silence(),
    sampleRate: 16000,
    durationMs: 1000,
  });

  // Cancel only once the stream is genuinely in flight; cancelling before the
  // generator runs is a different case with no open bubble to close.
  await waitFor(() => events.tokens.length > 0);
  runtime.cancel();
  await pending;

  assert.equal(events.ends.length, 1);
  assert.equal(events.ends[0].aborted, true);
  assert.ok(events.tokens.length < 12, 'cancel should have truncated the stub stream');

  runtime.dispose();
});

test('a new utterance aborts the turn still generating', async () => {
  const { events, handlers } = collector();
  const runtime = createAgentRuntime(handlers);

  const first = runtime.submitUtterance({
    speaker: 'remote',
    pcm: silence(),
    sampleRate: 16000,
    durationMs: 1000,
  });
  await waitFor(() => events.tokens.length > 0);

  const second = runtime.submitUtterance({
    speaker: 'remote',
    pcm: silence(),
    sampleRate: 16000,
    durationMs: 1000,
  });
  await Promise.all([first, second]);

  assert.equal(events.starts.length, 2, 'both turns should have announced');
  assert.equal(events.ends.length, 2);
  assert.equal(events.ends[0].aborted, true, 'first turn should be aborted');
  assert.equal(events.ends[1].aborted, false, 'second turn should complete');
  assert.notEqual(events.starts[0].turnId, events.starts[1].turnId);

  runtime.dispose();
});

test('clear empties the transcript history', async () => {
  const { handlers } = collector();
  const runtime = createAgentRuntime(handlers);

  await runtime.submitUtterance({
    speaker: 'remote',
    pcm: silence(),
    sampleRate: 16000,
    durationMs: 1000,
  });
  assert.ok(runtime.transcriptLength() > 0);

  runtime.clear();
  assert.equal(runtime.transcriptLength(), 0);

  runtime.dispose();
});

test('ask re-runs the last remote utterance without re-transcribing', async () => {
  const { events, handlers } = collector();
  const runtime = createAgentRuntime(handlers);

  await runtime.submitUtterance({
    speaker: 'remote',
    pcm: silence(),
    sampleRate: 16000,
    durationMs: 1000,
  });
  const transcriptsAfterFirst = events.transcripts.length;
  const spoken = events.transcripts[0].text;

  await runtime.ask();

  assert.equal(events.starts.length, 2);
  // The re-run carries no audio, so it must not append a second transcript
  // line for the same utterance.
  assert.equal(events.transcripts.length, transcriptsAfterFirst);
  // Tokens arrive word by word, so assert against the reassembled stream.
  const streamed = events.tokens.map((t) => t.token).join('');
  assert.ok(
    streamed.includes(spoken),
    'the re-run should have generated against the original utterance'
  );

  runtime.dispose();
});

test('dispose stops the runtime accepting new work', async () => {
  const { events, handlers } = collector();
  const runtime = createAgentRuntime(handlers);
  runtime.dispose();

  await runtime.submitUtterance({
    speaker: 'remote',
    pcm: silence(),
    sampleRate: 16000,
    durationMs: 1000,
  });

  assert.equal(events.starts.length, 0);
});

// ---------------------------------------------------------------------------
// Phase 2: real STT changes the abort boundary
// ---------------------------------------------------------------------------

test('a turn aborted before generation never announces', async () => {
  // With real STT, transcription takes hundreds of milliseconds and does not
  // honour the abort signal. A turn superseded during transcription therefore
  // still reaches the generator — and must not open an overlay bubble it will
  // immediately close.
  const { createGenerator } = require('../src/graph/nodes/generator');

  let announced = false;
  const tokens = [];
  const controller = new AbortController();
  controller.abort();

  const generator = createGenerator({ onToken: (_id, t) => tokens.push(t) });
  const result = await generator(
    { turnId: 'turn-x', utterance: 'anything' },
    { configurable: { signal: controller.signal, announce: () => (announced = true) } }
  );

  assert.equal(announced, false, 'an already-aborted turn must not announce');
  assert.equal(tokens.length, 0);
  assert.equal(result.response, '');
});

test('runtime forwards an injected transcribe to the transcriber', async () => {
  const { events, handlers } = collector();
  const calls = [];

  const runtime = createAgentRuntime({
    ...handlers,
    transcribe: async (pcm, sampleRate) => {
      calls.push({ length: pcm.length, sampleRate });
      return 'Injected transcript from the fake recogniser.';
    },
  });

  await runtime.submitUtterance({
    speaker: 'remote',
    pcm: silence(),
    sampleRate: 16000,
    durationMs: 1000,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].length, 16000);
  assert.equal(calls[0].sampleRate, 16000);
  assert.equal(events.transcripts[0].text, 'Injected transcript from the fake recogniser.');

  runtime.dispose();
});

test('a transcriber failure surfaces as an error without killing the runtime', async () => {
  const { events, handlers } = collector();

  const runtime = createAgentRuntime({
    ...handlers,
    transcribe: async () => {
      throw new Error('whisper: fetch failed');
    },
  });

  await runtime.submitUtterance({
    speaker: 'remote',
    pcm: silence(),
    sampleRate: 16000,
    durationMs: 1000,
  });

  assert.equal(events.errors.length, 1);
  assert.match(events.errors[0].message, /whisper: fetch failed/);
  assert.equal(events.starts.length, 0, 'a failed transcription must not open a bubble');

  runtime.dispose();
});

test('the operator speaking does not cancel the answer they are reading', async () => {
  // The whole point of the overlay is that you read it while you talk. If your
  // own voice aborts generation, the advice vanishes exactly when you start
  // using it. Found by watching a real run: the mic echo of the interviewer's
  // question killed the answer to that same question.
  const { events, handlers } = collector();

  const runtime = createAgentRuntime({
    ...handlers,
    transcribe: async (pcm, sampleRate, speaker) => 'How would you shard this table?',
    stream: async function* () {
      for (const token of ['Range ', 'partition ', 'on ', 'tenant ', 'id.']) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        yield token;
      }
    },
  });

  const answering = runtime.submitUtterance({
    speaker: 'remote',
    pcm: silence(),
    sampleRate: 16000,
    durationMs: 1000,
  });
  await waitFor(() => events.tokens.length > 0);

  // The operator starts talking mid-answer.
  await runtime.submitUtterance({
    speaker: 'user',
    pcm: silence(),
    sampleRate: 16000,
    durationMs: 1000,
  });
  await answering;

  assert.equal(events.ends.length, 1);
  assert.equal(events.ends[0].aborted, false, 'own speech must not abort the answer');
  assert.equal(events.tokens.length, 5, 'the full answer should have streamed');

  runtime.dispose();
});

test('a deliberate supersede is not reported as an error', async () => {
  // Cancelling on purpose is not a failure, and surfacing it puts "Aborted" in
  // the overlay's error banner every time the interviewer asks a follow-up.
  const { events, handlers } = collector();

  const runtime = createAgentRuntime({
    ...handlers,
    transcribe: async () => 'A real question about sharding?',
    // Throws on abort, which is what ChatOllama actually does. A fake that
    // returns quietly instead would hide this bug — it did, on the first try.
    stream: async function* (_state, signal) {
      for (let i = 0; i < 20; i++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        if (signal?.aborted) {
          const err = new Error('Aborted');
          err.name = 'AbortError';
          throw err;
        }
        yield `t${i} `;
      }
    },
  });

  const first = runtime.submitUtterance({
    speaker: 'remote',
    pcm: silence(),
    sampleRate: 16000,
    durationMs: 1000,
  });
  await waitFor(() => events.tokens.length > 0);

  const second = runtime.submitUtterance({
    speaker: 'remote',
    pcm: silence(),
    sampleRate: 16000,
    durationMs: 1000,
  });
  await Promise.all([first, second]);

  assert.equal(events.ends[0].aborted, true, 'the first turn should still be marked aborted');
  assert.deepEqual(events.errors, [], 'but no error should reach the overlay');

  runtime.dispose();
});

test('runtime forwards an injected search to the retriever', async () => {
  const { events, handlers } = collector();
  const queries = [];

  const runtime = createAgentRuntime({
    ...handlers,
    transcribe: async () => 'Tell me about a hard bug you debugged.',
    search: async (text) => {
      queries.push(text);
      return [{ text: 'A race in the session cache.', score: 0.8, source: 's.md', heading: 'Bug' }];
    },
    stream: async function* (state) {
      // The retrieved context must have reached the generator's state, or the
      // whole retrieval path is decorative.
      yield state.retrieved.length > 0 ? 'grounded' : 'ungrounded';
    },
  });

  await runtime.submitUtterance({
    speaker: 'remote',
    pcm: silence(),
    sampleRate: 16000,
    durationMs: 1000,
  });

  assert.deepEqual(queries, ['Tell me about a hard bug you debugged.']);
  assert.equal(events.tokens.map((t) => t.token).join(''), 'grounded');

  runtime.dispose();
});

test("the operator's own speech never triggers a search", async () => {
  // Triage rejects it before the retriever, so this asserts the graph edge
  // rather than the retriever's own behaviour — an embedding call per sentence
  // the operator speaks would be pure waste.
  const { handlers } = collector();
  let searches = 0;

  const runtime = createAgentRuntime({
    ...handlers,
    transcribe: async () => 'I would range-partition on tenant id.',
    search: async () => {
      searches += 1;
      return [];
    },
  });

  await runtime.submitUtterance({
    speaker: 'user',
    pcm: silence(),
    sampleRate: 16000,
    durationMs: 1000,
  });

  assert.equal(searches, 0);

  runtime.dispose();
});

test('runtime forwards an injected stream to the generator', async () => {
  const { events, handlers } = collector();
  const seen = [];

  const runtime = createAgentRuntime({
    ...handlers,
    transcribe: async () => 'How would you rate limit an API?',
    stream: async function* (state) {
      seen.push(state.utterance);
      yield 'Token bucket. ';
      yield '• Redis INCR + EXPIRE';
    },
  });

  await runtime.submitUtterance({
    speaker: 'remote',
    pcm: silence(),
    sampleRate: 16000,
    durationMs: 1000,
  });

  assert.deepEqual(seen, ['How would you rate limit an API?']);
  const streamed = events.tokens.map((t) => t.token).join('');
  assert.equal(streamed, 'Token bucket. • Redis INCR + EXPIRE');
  assert.equal(events.ends[0].aborted, false);

  runtime.dispose();
});

test('an empty transcript produces no transcript line and no turn', async () => {
  // whisper returns '' for a cough that got past the VAD.
  const { events, handlers } = collector();

  const runtime = createAgentRuntime({
    ...handlers,
    transcribe: async () => '',
  });

  await runtime.submitUtterance({
    speaker: 'remote',
    pcm: silence(),
    sampleRate: 16000,
    durationMs: 1000,
  });

  assert.equal(events.transcripts.length, 0);
  assert.equal(events.starts.length, 0);

  runtime.dispose();
});
