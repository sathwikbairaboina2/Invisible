'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { checkSetup } = require('../src/main/setup-check');

/** Everything present and healthy. Individual tests break one thing at a time. */
function healthy(overrides = {}) {
  return {
    fileExists: () => true,
    fileSize: () => 1_624_555_275,
    dockerPs: async () => ['invisible-ollama', 'invisible-qdrant'],
    ollamaProbe: async () => ({ ok: true, hasModel: true, models: ['qwen2.5-coder:14b'] }),
    qdrantProbe: async () => ({ ok: true, exists: true, points: 42 }),
    config: {
      whisper: { binary: 'bin/whisper-server.exe', model: 'models/ggml-large-v3-turbo.bin' },
      agent: { model: 'qwen2.5-coder:14b', ollamaBaseUrl: 'http://127.0.0.1:11435' },
    },
    ...overrides,
  };
}

const byId = (report, id) => report.checks.find((check) => check.id === id);

test('reports everything ok when the machine is fully set up', async () => {
  const report = await checkSetup(healthy());

  assert.equal(report.ok, true);
  assert.ok(report.checks.length >= 6, 'every dependency should be listed, not just failures');
  for (const check of report.checks) {
    assert.equal(check.state, 'ok', `${check.id} should be ok`);
    assert.equal(check.fix, null, 'a passing check needs no fix command');
  }
});

test('a stopped Docker daemon is reported once, not as six separate failures', async () => {
  // Docker being down makes the container, model, and Qdrant checks fail too.
  // Six red rows for one cause is noise; the operator needs the root cause.
  const report = await checkSetup(
    healthy({
      dockerPs: async () => {
        throw new Error('error during connect: open //./pipe/dockerDesktopLinuxEngine');
      },
    })
  );

  assert.equal(report.ok, false);

  const docker = byId(report, 'docker');
  assert.equal(docker.state, 'error');
  assert.match(docker.detail, /Docker Desktop/i);

  // Downstream checks are reported as blocked rather than independently failed.
  assert.equal(byId(report, 'ollama-container').state, 'missing');
  assert.match(byId(report, 'ollama-container').detail, /Docker/i);
});

test('a missing container names the command that starts it', async () => {
  const report = await checkSetup(healthy({ dockerPs: async () => ['invisible-qdrant'] }));

  const check = byId(report, 'ollama-container');
  assert.equal(check.state, 'missing');
  assert.equal(check.fix, 'npm run services:up');
  assert.equal(report.ok, false);
});

test('a reachable Ollama without the model names the pull command', async () => {
  const report = await checkSetup(
    healthy({ ollamaProbe: async () => ({ ok: true, hasModel: false, models: [] }) })
  );

  const check = byId(report, 'ollama-model');
  assert.equal(check.state, 'missing');
  assert.equal(check.fix, 'npm run ollama:pull');
});

test('a missing whisper binary names the fetch script', async () => {
  const report = await checkSetup(healthy({ fileExists: (p) => !p.includes('whisper-server') }));

  const check = byId(report, 'whisper-binary');
  assert.equal(check.state, 'missing');
  assert.equal(check.fix, 'npm run fetch-whisper');
});

test('a truncated whisper model is an error, not a pass', async () => {
  // An interrupted 1.6 GB download leaves a file that exists and is useless.
  const report = await checkSetup(healthy({ fileSize: () => 12_345 }));

  const check = byId(report, 'whisper-model');
  assert.equal(check.state, 'error');
  assert.match(check.detail, /incomplete|truncated/i);
  assert.equal(check.fix, 'npm run fetch-whisper');
});

test('an empty corpus is reported without failing setup overall', async () => {
  // The app works perfectly well with no corpus; answers are just less
  // specific. Marking it a failure would train the operator to ignore red.
  const report = await checkSetup(
    healthy({ qdrantProbe: async () => ({ ok: true, exists: true, points: 0 }) })
  );

  const check = byId(report, 'corpus');
  assert.equal(check.state, 'missing');
  assert.equal(check.fix, 'npm run ingest');
  assert.equal(report.ok, true, 'an empty corpus must not block startup readiness');
});

test('an unreachable Qdrant does fail setup', async () => {
  const report = await checkSetup(
    healthy({
      qdrantProbe: async () => ({ ok: false, exists: false, points: 0, error: 'ECONNREFUSED' }),
    })
  );

  assert.equal(byId(report, 'qdrant-container').state, 'ok', 'the container is running');
  assert.equal(byId(report, 'corpus').state, 'error');
  assert.equal(report.ok, false);
});

test('a probe that throws becomes an error row rather than crashing the report', async () => {
  // This runs on a settings window open; one broken probe must not blank the
  // whole panel.
  const report = await checkSetup(
    healthy({
      ollamaProbe: async () => {
        throw new Error('boom');
      },
    })
  );

  const check = byId(report, 'ollama-model');
  assert.equal(check.state, 'error');
  assert.match(check.detail, /boom/);
});
