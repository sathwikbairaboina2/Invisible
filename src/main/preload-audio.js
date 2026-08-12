'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const { CHANNELS, AUDIO_SEND, AUDIO_LISTEN } = require('./channels');

function subscribe(channel, handler) {
  if (!AUDIO_LISTEN.includes(channel)) {
    throw new Error(`preload-audio: refusing to listen on unlisted channel "${channel}"`);
  }
  const wrapped = (_event, payload) => handler(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

function send(channel, payload) {
  if (!AUDIO_SEND.includes(channel)) {
    throw new Error(`preload-audio: refusing to send on unlisted channel "${channel}"`);
  }
  ipcRenderer.send(channel, payload);
}

contextBridge.exposeInMainWorld('invisibleAudio', {
  onStart: (fn) => subscribe(CHANNELS.AUDIO_START, fn),
  onStop: (fn) => subscribe(CHANNELS.AUDIO_STOP, fn),

  ready: () => send(CHANNELS.AUDIO_READY),
  speechStart: (speaker) => send(CHANNELS.AUDIO_SPEECH_START, { speaker }),

  /**
   * @param {{speaker: 'user'|'remote', pcm: ArrayBuffer, sampleRate: number,
   *          durationMs: number}} payload
   */
  utterance: (payload) => send(CHANNELS.AUDIO_UTTERANCE, payload),
  level: (speaker, value) => send(CHANNELS.AUDIO_LEVEL, { speaker, level: value }),
  error: (message) => send(CHANNELS.AUDIO_ERROR, { message: String(message) }),
});
