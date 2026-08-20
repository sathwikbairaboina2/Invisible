'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createSettingsStore } = require('../src/main/settings-store');
const {
  SESSION_DEFAULTS,
  SESSION_EDITABLE,
  isValidMode,
} = require('../src/main/session-defaults');

function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'invisible-session-'));
  return path.join(dir, 'session.json');
}

function makeStore(filePath = tempFile()) {
  return createSettingsStore({
    defaults: SESSION_DEFAULTS,
    filePath,
    editable: SESSION_EDITABLE,
  });
}

test('defaults to meeting mode with an empty profile', () => {
  const store = makeStore();
  const session = store.get();
  assert.equal(session.mode, 'meeting');
  assert.deepEqual(session.profile, {
    company: '',
    role: '',
    jobDescription: '',
    title: '',
    attendees: '',
    agenda: '',
  });
});

test('mode toggle persists across store instances', () => {
  const filePath = tempFile();
  makeStore(filePath).set({ mode: 'interview' });
  assert.equal(makeStore(filePath).get().mode, 'interview');
});

test('profile fields set and clear', () => {
  const store = makeStore();
  store.set({ profile: { company: 'Acme', role: 'SRE' } });
  assert.equal(store.get().profile.company, 'Acme');

  store.set({
    profile: { company: '', role: '', jobDescription: '', title: '', attendees: '', agenda: '' },
  });
  assert.equal(store.get().profile.company, '');
  assert.equal(store.get().mode, 'meeting', 'clearing profile leaves mode alone');
});

test('unknown keys are rejected on write', () => {
  assert.throws(() => makeStore().set({ profile: { linkedin: 'x' } }), /unknown setting/);
  assert.throws(() => makeStore().set({ theme: 'dark' }), /unknown setting/);
});

test('corrupt session file degrades to defaults', () => {
  const filePath = tempFile();
  fs.writeFileSync(filePath, '{not json', 'utf8');
  assert.equal(makeStore(filePath).get().mode, 'meeting');
});

test('isValidMode accepts exactly the two literals', () => {
  assert.equal(isValidMode('interview'), true);
  assert.equal(isValidMode('meeting'), true);
  assert.equal(isValidMode('Interview'), false);
  assert.equal(isValidMode(''), false);
  assert.equal(isValidMode(undefined), false);
});
