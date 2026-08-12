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

// ---------------------------------------------------------------------------
// Hardening: this store is reachable from any renderer over IPC, and its file
// is plain user-writable JSON. Neither may be able to choose what gets
// executed or where the transcript is sent.
// ---------------------------------------------------------------------------

const HARDENED = {
  defaults: {
    whisper: { binary: 'bin/whisper-server.exe', port: 8178 },
    agent: {
      ollamaBaseUrl: 'http://127.0.0.1:11435',
      model: 'qwen2.5-coder:14b',
      temperature: 0.2,
      qdrant: { url: 'http://127.0.0.1:6333', scoreThreshold: 0.6 },
    },
  },
  editable: ['agent.temperature', 'agent.qdrant.scoreThreshold'],
};

test('refuses to let a caller choose which executable gets spawned', () => {
  // createSidecar spawns config.whisper.binary. Anything that can write this
  // store could otherwise pick the program, and settings.json is an ordinary
  // user-writable file — no renderer compromise required.
  const store = createSettingsStore({ ...HARDENED, filePath: tempFile() });

  assert.throws(
    () => store.set({ whisper: { binary: 'C:\\Windows\\System32\\calc.exe' } }),
    /not editable/
  );
  assert.equal(store.get().whisper.binary, 'bin/whisper-server.exe');
});

test('refuses to redirect the model endpoint off the machine', () => {
  // "Nothing leaves the machine" is the central promise of this design. A
  // settable base URL would hand every transcript to a remote host.
  const store = createSettingsStore({ ...HARDENED, filePath: tempFile() });

  assert.throws(
    () => store.set({ agent: { ollamaBaseUrl: 'http://evil.example.com' } }),
    /not editable/
  );
  assert.throws(
    () => store.set({ agent: { qdrant: { url: 'http://evil.example.com' } } }),
    /not editable/
  );
});

test('still allows the tuning values the settings window exposes', () => {
  const store = createSettingsStore({ ...HARDENED, filePath: tempFile() });

  const next = store.set({ agent: { temperature: 0.5, qdrant: { scoreThreshold: 0.7 } } });
  assert.equal(next.agent.temperature, 0.5);
  assert.equal(next.agent.qdrant.scoreThreshold, 0.7);
});

test('ignores non-editable keys already present in the file on disk', () => {
  // Validation on write is not enough: the file is user-writable, so anything
  // could put a path in it directly and never call set().
  const filePath = tempFile();
  fs.writeFileSync(
    filePath,
    JSON.stringify({
      whisper: { binary: 'C:\\Windows\\System32\\calc.exe' },
      agent: { temperature: 0.9 },
    })
  );

  const store = createSettingsStore({ ...HARDENED, filePath });

  assert.equal(store.get().whisper.binary, 'bin/whisper-server.exe', 'injected path ignored');
  assert.equal(store.get().agent.temperature, 0.9, 'legitimate override still applied');
});

test('rejects prototype-manipulating keys explicitly', () => {
  // Currently unreachable because the recursive walk rejects them a level
  // down, but that is safety by accident. Asserted so it stays deliberate.
  const store = createSettingsStore({ ...HARDENED, filePath: tempFile() });

  assert.throws(() => store.set(JSON.parse('{"__proto__":{"x":1}}')), /not editable|unknown/);
  assert.throws(() => store.set(JSON.parse('{"constructor":{"x":1}}')), /not editable|unknown/);
  assert.equal({}.x, undefined);
});

test('survives a corrupt settings file rather than failing to launch', () => {
  // A half-written file must not brick the app on the morning of an interview.
  const filePath = tempFile();
  fs.writeFileSync(filePath, '{ this is not json');

  const store = createSettingsStore({ defaults: DEFAULTS, filePath });
  assert.deepEqual(store.get(), DEFAULTS);
});
