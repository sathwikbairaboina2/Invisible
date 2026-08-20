'use strict';

/**
 * Per-meeting session state: which mode the assistant is in and who the
 * meeting is with. Persisted by a second createSettingsStore instance so it
 * survives a restart on the morning of an interview, but kept out of
 * settings.json so "reset settings" never wipes a prepared profile.
 */
const SESSION_DEFAULTS = {
  /** 'interview' | 'meeting' */
  mode: 'meeting',
  /**
   * Answer shape: 'auto' resolves per mode (interview → spoken, meeting →
   * bullets); the rest pin a shape regardless of mode.
   */
  stylePreset: 'auto',
  profile: {
    // Interview mode
    company: '',
    role: '',
    jobDescription: '',
    // Meeting mode
    title: '',
    attendees: '',
    agenda: '',
  },
};

/** Every leaf is operator-editable; the store rejects anything else. */
const SESSION_EDITABLE = [
  'mode',
  'stylePreset',
  'profile.company',
  'profile.role',
  'profile.jobDescription',
  'profile.title',
  'profile.attendees',
  'profile.agenda',
];

/** The store validates types; the literal check needs this extra gate. */
function isValidMode(value) {
  return value === 'interview' || value === 'meeting';
}

/** Cycle order for the style hotkey; index 0 is the default. */
const STYLE_PRESETS = ['auto', 'bullets', 'spoken', 'brief'];

function isValidStylePreset(value) {
  return STYLE_PRESETS.includes(value);
}

module.exports = {
  SESSION_DEFAULTS,
  SESSION_EDITABLE,
  isValidMode,
  STYLE_PRESETS,
  isValidStylePreset,
};
