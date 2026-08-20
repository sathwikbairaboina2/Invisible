'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CHANNELS,
  RENDERER_LISTEN,
  OVERLAY_SEND,
  RENDERER_INVOKE,
  AUDIO_SEND,
  AUDIO_LISTEN,
} = require('../src/main/channels');

const ALL = Object.values(CHANNELS);
const LISTS = { RENDERER_LISTEN, OVERLAY_SEND, RENDERER_INVOKE, AUDIO_SEND, AUDIO_LISTEN };

test('every channel name is unique', () => {
  assert.equal(new Set(ALL).size, ALL.length, 'duplicate channel string in CHANNELS');
});

test('every allow-list entry exists in CHANNELS', () => {
  for (const [name, list] of Object.entries(LISTS)) {
    for (const channel of list) {
      assert.ok(ALL.includes(channel), `${name} references unknown channel "${channel}"`);
    }
  }
});

test('no allow-list contains duplicates', () => {
  for (const [name, list] of Object.entries(LISTS)) {
    assert.equal(new Set(list).size, list.length, `${name} has a duplicate entry`);
  }
});

test('send and listen lists do not overlap within a renderer', () => {
  // A renderer that could both send and listen on one channel could echo its
  // own messages back into its own handler.
  for (const channel of OVERLAY_SEND) {
    assert.ok(!RENDERER_LISTEN.includes(channel), `overlay both sends and listens on "${channel}"`);
  }
  for (const channel of AUDIO_SEND) {
    assert.ok(!AUDIO_LISTEN.includes(channel), `audio worker both sends and listens on "${channel}"`);
  }
});

test('session channels are invokable and ask-open is listenable', () => {
  assert.ok(RENDERER_INVOKE.includes(CHANNELS.SESSION_GET));
  assert.ok(RENDERER_INVOKE.includes(CHANNELS.SESSION_SET));
  assert.ok(RENDERER_LISTEN.includes(CHANNELS.OVERLAY_ASK_OPEN));
});

test('corpus channels are invokable', () => {
  assert.ok(RENDERER_INVOKE.includes(CHANNELS.CORPUS_STATUS));
  assert.ok(RENDERER_INVOKE.includes(CHANNELS.CORPUS_INGEST));
});

test('every channel is reachable from at least one allow-list', () => {
  const reachable = new Set([
    ...RENDERER_LISTEN,
    ...OVERLAY_SEND,
    ...RENDERER_INVOKE,
    ...AUDIO_SEND,
    ...AUDIO_LISTEN,
  ]);
  const orphans = ALL.filter((c) => !reachable.has(c));
  assert.deepEqual(orphans, [], `channels declared but wired to nobody: ${orphans.join(', ')}`);
});
