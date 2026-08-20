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

module.exports = { SESSION_DEFAULTS, SESSION_EDITABLE, isValidMode };
