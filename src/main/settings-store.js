'use strict';

const fs = require('node:fs');
const path = require('node:path');

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, patch) {
  const out = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    out[key] =
      isPlainObject(value) && isPlainObject(base?.[key]) ? deepMerge(base[key], value) : value;
  }
  return out;
}

/**
 * Walks `patch` against `defaults`, rejecting unknown keys, type changes, and
 * anything outside the editable allow-list. Throws on the first problem,
 * naming the dotted path.
 *
 * @param {Set<string>|null} editable dotted paths that may be written
 */
function validate(defaults, patch, editable, trail = []) {
  for (const [key, value] of Object.entries(patch)) {
    const dotted = [...trail, key].join('.');

    // Object.hasOwn, not `in`: `'__proto__' in anything` and
    // `'constructor' in anything` are both true via the prototype chain. The
    // recursive walk happens to reject them a level down, but relying on that
    // is safety by accident.
    if (!Object.hasOwn(defaults, key)) {
      throw new Error(`unknown setting "${dotted}"`);
    }

    const fallback = defaults[key];

    if (isPlainObject(fallback)) {
      if (!isPlainObject(value)) throw new Error(`"${dotted}" must be an object`);
      validate(fallback, value, editable, [...trail, key]);
      continue;
    }

    // The allow-list is checked at the leaf, where the actual value lands.
    if (editable && !editable.has(dotted)) {
      throw new Error(`"${dotted}" is not editable`);
    }

    if (typeof value !== typeof fallback) {
      throw new Error(`"${dotted}" must be a ${typeof fallback}, got ${typeof value}`);
    }
  }
}

/** Drops anything from `patch` that is not an editable leaf. Never throws. */
function prune(defaults, patch, editable, trail = []) {
  const out = {};

  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(defaults, key)) continue;

    const dotted = [...trail, key].join('.');
    const fallback = defaults[key];

    if (isPlainObject(fallback)) {
      if (!isPlainObject(value)) continue;
      const nested = prune(fallback, value, editable, [...trail, key]);
      if (Object.keys(nested).length > 0) out[key] = nested;
      continue;
    }

    if (editable && !editable.has(dotted)) continue;
    if (typeof value !== typeof fallback) continue;

    out[key] = value;
  }

  return out;
}

/**
 * Defaults from config.js, overlaid with whatever the operator changed.
 *
 * Only the overrides are written to disk. Persisting the merged result would
 * freeze today's defaults permanently: a later change to a value the operator
 * never touched would be silently ignored because their file already pins it.
 *
 * `editable` is an allow-list of dotted paths. Everything outside it is
 * rejected on write and silently dropped on read.
 *
 * That matters because this store decides two things an attacker would want:
 * `whisper.binary`, which is handed to spawn(), and the Ollama and Qdrant base
 * URLs, which decide where transcripts are sent. Without the allow-list,
 * anything able to write this file could choose the program that runs at next
 * launch, or point the model at a remote host and break the central promise
 * that nothing leaves the machine. The file is ordinary user-writable JSON, so
 * that does not even require compromising a renderer.
 *
 * @param {{defaults: object, filePath: string, editable?: string[]}} options
 */
function createSettingsStore({ defaults, filePath, editable } = {}) {
  if (!defaults) throw new TypeError('createSettingsStore: defaults are required');
  if (!filePath) throw new TypeError('createSettingsStore: filePath is required');

  const allowed = Array.isArray(editable) ? new Set(editable) : null;

  /** @type {object} */
  let overrides = {};

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    // Pruned rather than validated: the file is user-writable, so injected
    // keys are dropped instead of failing the launch over someone else's edit.
    overrides = isPlainObject(parsed) ? prune(defaults, parsed, allowed) : {};
  } catch {
    // Missing is normal on first run. Corrupt must not brick the app on the
    // morning of an interview, so it degrades to defaults just the same.
    overrides = {};
  }

  function persist() {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    // Write-then-rename: a crash mid-write leaves the previous file intact
    // rather than a truncated one that reads as corrupt on next launch.
    const temp = `${filePath}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(overrides, null, 2), 'utf8');
    fs.renameSync(temp, filePath);
  }

  function get() {
    return deepMerge(defaults, overrides);
  }

  function set(patch) {
    if (!isPlainObject(patch)) throw new TypeError('settings patch must be an object');
    validate(defaults, patch, allowed);
    overrides = deepMerge(overrides, patch);
    persist();
    return get();
  }

  function reset() {
    overrides = {};
    persist();
    return get();
  }

  return { get, set, reset, path: filePath };
}

module.exports = { createSettingsStore };
