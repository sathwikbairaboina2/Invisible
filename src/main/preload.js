'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const { CHANNELS, RENDERER_LISTEN, OVERLAY_SEND } = require('./channels');

/**
 * Subscribes to a main-process channel. The IpcRendererEvent is deliberately
 * not forwarded: a renderer that can reach `event.sender` can reach the whole
 * webContents API surface.
 *
 * @returns {() => void} unsubscribe
 */
function subscribe(channel, handler) {
  if (!RENDERER_LISTEN.includes(channel)) {
    throw new Error(`preload: refusing to listen on unlisted channel "${channel}"`);
  }
  if (typeof handler !== 'function') {
    throw new TypeError('preload: handler must be a function');
  }
  const wrapped = (_event, payload) => handler(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

function send(channel, payload) {
  if (!OVERLAY_SEND.includes(channel)) {
    throw new Error(`preload: refusing to send on unlisted channel "${channel}"`);
  }
  ipcRenderer.send(channel, payload);
}

contextBridge.exposeInMainWorld('invisible', {
  onTurnStart: (fn) => subscribe(CHANNELS.AGENT_TURN_START, fn),
  onToken: (fn) => subscribe(CHANNELS.AGENT_TOKEN, fn),
  onTurnEnd: (fn) => subscribe(CHANNELS.AGENT_TURN_END, fn),
  onError: (fn) => subscribe(CHANNELS.AGENT_ERROR, fn),
  onTranscriptPartial: (fn) => subscribe(CHANNELS.TRANSCRIPT_PARTIAL, fn),
  onTranscriptFinal: (fn) => subscribe(CHANNELS.TRANSCRIPT_FINAL, fn),
  onStatus: (fn) => subscribe(CHANNELS.STATUS, fn),
  onMode: (fn) => subscribe(CHANNELS.OVERLAY_MODE, fn),

  ready: () => send(CHANNELS.OVERLAY_READY),
  cancel: () => send(CHANNELS.AGENT_CANCEL),
  clear: () => send(CHANNELS.AGENT_CLEAR),
  ask: (question) => send(CHANNELS.AGENT_ASK, { question: String(question ?? '') }),
  setInteractive: (interactive) =>
    send(CHANNELS.OVERLAY_SET_INTERACTIVE, { interactive: Boolean(interactive) }),
});
