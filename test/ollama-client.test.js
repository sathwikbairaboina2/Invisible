'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createOllamaClient } = require('../src/ollama/client');

/**
 * Minimal stand-in for ChatOllama: records the call, yields canned chunks.
 *
 * `stream` is an async function returning an async generator, not an async
 * generator itself. That distinction is load-bearing: LangChain's
 * Runnable.stream() returns a Promise of an IterableReadableStream, so a fake
 * that is directly iterable would let broken code pass. It did, once.
 */
function fakeChat(chunks, record = {}) {
  return {
    async stream(messages, options) {
      record.messages = messages;
      record.options = options;
      return (async function* () {
        for (const chunk of chunks) {
          if (options?.signal?.aborted) return;
          yield { content: chunk };
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      })();
    },
  };
}

async function collect(iterable) {
  const out = [];
  for await (const item of iterable) out.push(item);
  return out;
}

test('streams the model content out as plain strings', async () => {
  const client = createOllamaClient({
    baseUrl: 'http://x',
    model: 'm',
    chatImpl: fakeChat(['Token ', 'bucket, ', 'Redis-backed.']),
  });

  const tokens = await collect(client.stream({ utterance: 'How to rate limit?' }));
  assert.deepEqual(tokens, ['Token ', 'bucket, ', 'Redis-backed.']);
});

test('passes the built prompt through to the model', async () => {
  const record = {};
  const client = createOllamaClient({
    baseUrl: 'http://x',
    model: 'm',
    chatImpl: fakeChat(['ok'], record),
  });

  await collect(
    client.stream({
      utterance: 'Why not a queue?',
      transcript: [{ speaker: 'remote', text: 'Why not a queue?' }],
    })
  );

  assert.equal(record.messages[0].role, 'system');
  assert.match(record.messages[0].content, /heads-up display/);
  assert.match(record.messages[1].content, /Why not a queue\?/);
});

test('stops yielding once the signal aborts', async () => {
  const client = createOllamaClient({
    baseUrl: 'http://x',
    model: 'm',
    chatImpl: fakeChat(['a', 'b', 'c', 'd', 'e', 'f']),
  });

  const controller = new AbortController();
  const tokens = [];

  for await (const token of client.stream({ utterance: 'q' }, controller.signal)) {
    tokens.push(token);
    if (tokens.length === 2) controller.abort();
  }

  assert.ok(tokens.length < 6, `expected an early stop, got ${tokens.length} tokens`);
});

test('forwards the signal to the model so the HTTP request is cancelled too', async () => {
  // Breaking our own loop stops the overlay updating, but the model would keep
  // generating and holding the GPU. The signal has to reach the client.
  const record = {};
  const client = createOllamaClient({
    baseUrl: 'http://x',
    model: 'm',
    chatImpl: fakeChat(['a'], record),
  });

  const controller = new AbortController();
  await collect(client.stream({ utterance: 'q' }, controller.signal));

  assert.equal(record.options.signal, controller.signal);
});

test('skips empty chunks rather than emitting blank tokens', async () => {
  const client = createOllamaClient({
    baseUrl: 'http://x',
    model: 'm',
    chatImpl: fakeChat(['Hello', '', ' world']),
  });

  const tokens = await collect(client.stream({ utterance: 'q' }));
  assert.deepEqual(tokens, ['Hello', ' world']);
});

test('warmup asks Ollama to load the model without generating anything', async () => {
  // A cold model load costs ~18 s and would otherwise land on the operator's
  // first question of the interview. An empty prompt is Ollama's documented
  // load-only call, so this pays that cost at app start and emits no tokens.
  const record = {};
  const client = createOllamaClient({
    baseUrl: 'http://127.0.0.1:11435',
    model: 'qwen2.5-coder:14b-instruct-q4_K_M',
    keepAlive: '30m',
    fetchImpl: async (url, init) => {
      record.url = url;
      record.body = JSON.parse(init.body);
      return { ok: true, json: async () => ({ done: true }) };
    },
  });

  const result = await client.warmup();

  assert.equal(record.url, 'http://127.0.0.1:11435/api/generate');
  assert.equal(record.body.model, 'qwen2.5-coder:14b-instruct-q4_K_M');
  assert.equal(record.body.prompt, '', 'an empty prompt loads without generating');
  assert.equal(record.body.keep_alive, '30m');
  assert.equal(result.ok, true);
});

test('warmup failure is reported, never thrown', async () => {
  const client = createOllamaClient({
    baseUrl: 'http://x',
    model: 'm',
    fetchImpl: async () => {
      throw new Error('connect ECONNREFUSED');
    },
  });

  const result = await client.warmup();
  assert.equal(result.ok, false);
  assert.match(result.error, /ECONNREFUSED/);
});

test('probe reports reachability and whether the model is pulled', async () => {
  const client = createOllamaClient({
    baseUrl: 'http://127.0.0.1:11435',
    model: 'qwen2.5-coder:14b-instruct-q4_K_M',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        models: [{ name: 'qwen2.5-coder:14b-instruct-q4_K_M' }, { name: 'llama3.2:1b' }],
      }),
    }),
  });

  const result = await client.probe();
  assert.equal(result.ok, true);
  assert.equal(result.hasModel, true);
  assert.deepEqual(result.models, ['qwen2.5-coder:14b-instruct-q4_K_M', 'llama3.2:1b']);
});

test('probe reports a reachable server that lacks the model', async () => {
  const client = createOllamaClient({
    baseUrl: 'http://x',
    model: 'qwen2.5-coder:14b-instruct-q4_K_M',
    fetchImpl: async () => ({ ok: true, json: async () => ({ models: [{ name: 'llama3.2:1b' }] }) }),
  });

  const result = await client.probe();
  assert.equal(result.ok, true);
  assert.equal(result.hasModel, false);
});

test('probe reports an unreachable server without throwing', async () => {
  const client = createOllamaClient({
    baseUrl: 'http://x',
    model: 'm',
    fetchImpl: async () => {
      throw new Error('fetch failed');
    },
  });

  const result = await client.probe();
  assert.equal(result.ok, false);
  assert.equal(result.hasModel, false);
  assert.match(result.error, /fetch failed/);
});
