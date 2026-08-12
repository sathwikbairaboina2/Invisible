'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createSettingsStore } = require('../src/main/settings-store');

function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'invisible-settings-'));
  return path.join(dir, 'settings.json');
}

const DEFAULTS = {
  agent: { temperature: 0.2, numPredict: 200, qdrant: { topK: 4, scoreThreshold: 0.6 } },
  audio: { vad: { redemptionMs: 384 } },
};

test('returns defaults when nothing has been saved', () => {
  const store = createSettingsStore({ defaults: DEFAULTS, filePath: tempFile() });
  assert.deepEqual(store.get(), DEFAULTS);
});

test('merges overrides without discarding sibling defaults', () => {
  // A shallow merge would drop numPredict and the whole qdrant block.
  const store = createSettingsStore({ defaults: DEFAULTS, filePath: tempFile() });

  const next = store.set({ agent: { temperature: 0.7 } });

  assert.equal(next.agent.temperature, 0.7);
  assert.equal(next.agent.numPredict, 200);
  assert.equal(next.agent.qdrant.topK, 4);
});

test('persists across store instances', () => {
  const filePath = tempFile();
  createSettingsStore({ defaults: DEFAULTS, filePath }).set({
    agent: { qdrant: { scoreThreshold: 0.72 } },
  });

  const reopened = createSettingsStore({ defaults: DEFAULTS, filePath });
  assert.equal(reopened.get().agent.qdrant.scoreThreshold, 0.72);
  assert.equal(reopened.get().agent.qdrant.topK, 4, 'siblings survive a round trip');
});

test('writes only the overrides, not the whole merged config', () => {
  // Persisting the merge would freeze today's defaults forever: a later change
  // to a default the operator never touched would be silently ignored.
  const filePath = tempFile();
  const store = createSettingsStore({ defaults: DEFAULTS, filePath });
  store.set({ agent: { temperature: 0.5 } });

  const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.deepEqual(onDisk, { agent: { temperature: 0.5 } });
});

test('reset removes every override', () => {
  const filePath = tempFile();
  const store = createSettingsStore({ defaults: DEFAULTS, filePath });
  store.set({ agent: { temperature: 0.9 } });

  assert.deepEqual(store.reset(), DEFAULTS);
  assert.deepEqual(store.get(), DEFAULTS);
});

test('rejects keys that do not exist in the defaults', () => {
  // The settings window is trusted, but this store is reachable over IPC and
  // an unknown key would sit in the file forever looking meaningful.
  const store = createSettingsStore({ defaults: DEFAULTS, filePath: tempFile() });

  assert.throws(() => store.set({ agent: { nonsense: 1 } }), /unknown setting "agent\.nonsense"/);
  assert.throws(() => store.set({ whatever: true }), /unknown setting "whatever"/);
});

test('rejects a value whose type differs from the default', () => {
  const store = createSettingsStore({ defaults: DEFAULTS, filePath: tempFile() });
  assert.throws(() => store.set({ agent: { temperature: 'hot' } }), /agent\.temperature.*number/);
});

test('survives a corrupt settings file rather than failing to launch', () => {
  // A half-written file must not brick the app on the morning of an interview.
  const filePath = tempFile();
  fs.writeFileSync(filePath, '{ this is not json');

  const store = createSettingsStore({ defaults: DEFAULTS, filePath });
  assert.deepEqual(store.get(), DEFAULTS);
});
