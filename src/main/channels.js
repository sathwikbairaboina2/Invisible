'use strict';

/**
 * Every IPC channel name in one place. Both preloads import this and use it as
 * an allow-list, so a compromised renderer cannot reach an unlisted channel.
 */
const CHANNELS = {
  // main -> overlay renderer
  AGENT_TOKEN: 'agent:token',
  AGENT_TURN_START: 'agent:turn-start',
  AGENT_TURN_END: 'agent:turn-end',
  AGENT_ERROR: 'agent:error',
  TRANSCRIPT_PARTIAL: 'transcript:partial',
  TRANSCRIPT_FINAL: 'transcript:final',
  STATUS: 'status:update',
  OVERLAY_MODE: 'overlay:mode',

  // overlay renderer -> main
  OVERLAY_READY: 'overlay:ready',
  AGENT_CANCEL: 'agent:cancel',
  AGENT_CLEAR: 'agent:clear',
  AGENT_ASK: 'agent:ask',
  OVERLAY_SET_INTERACTIVE: 'overlay:set-interactive',

  // main -> audio worker
  AUDIO_START: 'audio:start',
  AUDIO_STOP: 'audio:stop',

  // audio worker -> main
  AUDIO_UTTERANCE: 'audio:utterance',
  AUDIO_SPEECH_START: 'audio:speech-start',
  AUDIO_LEVEL: 'audio:level',
  AUDIO_ERROR: 'audio:error',
  AUDIO_READY: 'audio:ready',
};

/** Channels a renderer is allowed to listen on. */
const RENDERER_LISTEN = [
  CHANNELS.AGENT_TOKEN,
  CHANNELS.AGENT_TURN_START,
  CHANNELS.AGENT_TURN_END,
  CHANNELS.AGENT_ERROR,
  CHANNELS.TRANSCRIPT_PARTIAL,
  CHANNELS.TRANSCRIPT_FINAL,
  CHANNELS.STATUS,
  CHANNELS.OVERLAY_MODE,
];

/** Channels the overlay renderer is allowed to send on. */
const OVERLAY_SEND = [
  CHANNELS.OVERLAY_READY,
  CHANNELS.AGENT_CANCEL,
  CHANNELS.AGENT_CLEAR,
  CHANNELS.AGENT_ASK,
  CHANNELS.OVERLAY_SET_INTERACTIVE,
];

/** Channels the audio worker is allowed to send on. */
const AUDIO_SEND = [
  CHANNELS.AUDIO_UTTERANCE,
  CHANNELS.AUDIO_SPEECH_START,
  CHANNELS.AUDIO_LEVEL,
  CHANNELS.AUDIO_ERROR,
  CHANNELS.AUDIO_READY,
];

/** Channels the audio worker is allowed to listen on. */
const AUDIO_LISTEN = [CHANNELS.AUDIO_START, CHANNELS.AUDIO_STOP];

module.exports = { CHANNELS, RENDERER_LISTEN, OVERLAY_SEND, AUDIO_SEND, AUDIO_LISTEN };
