'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createWhisperClient, isNonSpeech } = require('../src/whisper/client');

/** Builds a fake fetch that records its call and returns a canned response. */
function fakeFetch(response, record = {}) {
  return async (url, init) => {
    record.url = url;
    record.init = init;
    record.body = init.body;
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => response,
    };
  };
}

const speech = () => Float32Array.from([0, 0.5, -0.5, 0]);

test('posts multipart to /inference with the documented field names', async () => {
  const record = {};
  const client = createWhisperClient({
    baseUrl: 'http://127.0.0.1:8178',
    fetchImpl: fakeFetch({ text: ' hello world ' }, record),
  });

  await client.transcribe(speech(), 16000);

  assert.equal(record.url, 'http://127.0.0.1:8178/inference');
  assert.equal(record.init.method, 'POST');
  assert.ok(record.body instanceof FormData);
  assert.equal(record.body.get('response_format'), 'verbose_json');
  assert.equal(record.body.get('temperature'), '0');

  const file = record.body.get('file');
  assert.ok(file instanceof Blob, 'file field must be a Blob');
  assert.equal(file.type, 'audio/wav');
  // 44-byte header plus 4 samples at 2 bytes each.
  assert.equal(file.size, 52);
});

test('trims the leading space whisper.cpp emits', async () => {
  const client = createWhisperClient({
    baseUrl: 'http://x',
    fetchImpl: fakeFetch({ text: ' Hello there.' }),
  });

  const result = await client.transcribe(speech(), 16000);
  assert.equal(result.text, 'Hello there.');
  assert.equal(typeof result.ms, 'number');
});

test('asks for verbose_json so per-segment confidence is available', async () => {
  const record = {};
  const client = createWhisperClient({
    baseUrl: 'http://x',
    fetchImpl: fakeFetch({ text: 'hi' }, record),
  });

  await client.transcribe(speech(), 16000);
  assert.equal(record.body.get('response_format'), 'verbose_json');
});

test('drops segments whisper itself scored as non-speech', async () => {
  // Whisper hallucinates fluent sentences onto room noise. Observed in real
  // use: "I need the Swarovs to produce now" from an empty room. The model
  // knows — no_speech_prob is high — but the text field does not show it.
  const client = createWhisperClient({
    baseUrl: 'http://x',
    fetchImpl: fakeFetch({
      text: ' I need the Swarovs to produce now.',
      segments: [
        { text: ' I need the Swarovs to produce now.', no_speech_prob: 0.93, avg_logprob: -0.4 },
      ],
    }),
  });

  const result = await client.transcribe(speech(), 16000);
  assert.equal(result.text, '');
});

test('drops segments the model was very unsure of', async () => {
  // Low average log-probability is the other hallucination signature: fluent
  // words the decoder had no confidence in.
  const client = createWhisperClient({
    baseUrl: 'http://x',
    fetchImpl: fakeFetch({
      text: ' Bagessele.',
      segments: [{ text: ' Bagessele.', no_speech_prob: 0.2, avg_logprob: -1.8 }],
    }),
  });

  const result = await client.transcribe(speech(), 16000);
  assert.equal(result.text, '');
});

test('keeps confident segments and drops the noise around them', async () => {
  // A real question preceded by a hallucinated fragment must survive intact.
  const client = createWhisperClient({
    baseUrl: 'http://x',
    fetchImpl: fakeFetch({
      text: ' The shapes there, man. How would you shard this table?',
      segments: [
        { text: ' The shapes there, man.', no_speech_prob: 0.88, avg_logprob: -0.9 },
        { text: ' How would you shard this table?', no_speech_prob: 0.02, avg_logprob: -0.3 },
      ],
    }),
  });

  const result = await client.transcribe(speech(), 16000);
  assert.equal(result.text, 'How would you shard this table?');
});

test('falls back to the top-level text when no segments are returned', async () => {
  // Keeps working against a server or format that omits segments rather than
  // silently transcribing everything to nothing.
  const client = createWhisperClient({
    baseUrl: 'http://x',
    fetchImpl: fakeFetch({ text: ' How would you shard this table?' }),
  });

  const result = await client.transcribe(speech(), 16000);
  assert.equal(result.text, 'How would you shard this table?');
});

test('collapses the newlines whisper.cpp puts between segments', async () => {
  // whisper.cpp joins its internal segments with newlines, so a single spoken
  // sentence comes back split mid-clause. Left alone it renders as a broken
  // line in the overlay and reaches the model as noise.
  const client = createWhisperClient({
    baseUrl: 'http://x',
    fetchImpl: fakeFetch({
      text: ' How would you design a distributed rate limiter for a\n public API?',
    }),
  });

  const result = await client.transcribe(speech(), 16000);
  assert.equal(result.text, 'How would you design a distributed rate limiter for a public API?');
});

test('maps whisper non-speech markers to an empty string', async () => {
  // VAD lets through the occasional cough or door slam. whisper.cpp labels
  // these rather than returning nothing, and those labels must never reach the
  // transcript or the triage node as if they were words.
  for (const marker of ['[BLANK_AUDIO]', '(silence)', '[SILENCE]', ' [ Silence ] ', '[MUSIC]']) {
    const client = createWhisperClient({
      baseUrl: 'http://x',
      fetchImpl: fakeFetch({ text: marker }),
    });
    const result = await client.transcribe(speech(), 16000);
    assert.equal(result.text, '', `"${marker}" should be treated as non-speech`);
  }
});

test('treats punctuation-only output as non-speech', async () => {
  // Measured against the real model: three seconds of white noise transcribes
  // to " ." with no_speech_prob of 1e-12 — whisper claiming near-certainty
  // that noise is speech. It clears every confidence threshold, so a
  // content-based rule is the only thing that catches it.
  for (const junk of ['.', ' . ', '...', '-', '?!']) {
    const client = createWhisperClient({
      baseUrl: 'http://x',
      fetchImpl: fakeFetch({ text: junk }),
    });
    const result = await client.transcribe(speech(), 16000);
    assert.equal(result.text, '', `"${junk}" should be treated as non-speech`);
  }
});

test('isNonSpeech leaves real transcripts alone', () => {
  assert.equal(isNonSpeech('How would you shard this table?'), false);
  assert.equal(isNonSpeech('The music was loud.'), false);
  assert.equal(isNonSpeech(''), true);
  assert.equal(isNonSpeech('   '), true);
});

test('raises a useful error on a non-2xx response', async () => {
  const client = createWhisperClient({
    baseUrl: 'http://x',
    fetchImpl: async () => ({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => ({}),
    }),
  });

  await assert.rejects(
    () => client.transcribe(speech(), 16000),
    /whisper: HTTP 500 Internal Server Error/
  );
});

test('raises a useful error when the response has no text field', async () => {
  const client = createWhisperClient({
    baseUrl: 'http://x',
    fetchImpl: fakeFetch({ unexpected: true }),
  });

  await assert.rejects(() => client.transcribe(speech(), 16000), /no text field/);
});

test('surfaces a connection failure as a whisper error', async () => {
  const client = createWhisperClient({
    baseUrl: 'http://x',
    fetchImpl: async () => {
      throw new Error('fetch failed');
    },
  });

  await assert.rejects(() => client.transcribe(speech(), 16000), /whisper: fetch failed/);
});

test('rejects an empty utterance without calling the server', async () => {
  let called = false;
  const client = createWhisperClient({
    baseUrl: 'http://x',
    fetchImpl: async () => {
      called = true;
      return { ok: true, status: 200, json: async () => ({ text: '' }) };
    },
  });

  const result = await client.transcribe(new Float32Array(0), 16000);
  assert.equal(result.text, '');
  assert.equal(called, false, 'zero-length audio must not reach the server');
});
