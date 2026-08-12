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
 * Walks `patch` against `defaults`, rejecting unknown keys and type changes.
 * Throws on the first problem, naming the dotted path.
 */
function validate(defaults, patch, trail = []) {
  for (const [key, value] of Object.entries(patch)) {
    const dotted = [...trail, key].join('.');

    if (!(key in defaults)) {
      throw new Error(`unknown setting "${dotted}"`);
    }

    const fallback = defaults[key];

    if (isPlainObject(fallback)) {
      if (!isPlainObject(value)) throw new Error(`"${dotted}" must be an object`);
      validate(fallback, value, [...trail, key]);
      continue;
    }

    if (typeof value !== typeof fallback) {
      throw new Error(`"${dotted}" must be a ${typeof fallback}, got ${typeof value}`);
    }
  }
}

/**
 * Defaults from config.js, overlaid with whatever the operator changed.
 *
 * Only the overrides are written to disk. Persisting the merged result would
 * freeze today's defaults permanently: a later change to a value the operator
 * never touched would be silently ignored because their file already pins it.
 *
 * @param {{defaults: object, filePath: string}} options
 */
function createSettingsStore({ defaults, filePath } = {}) {
  if (!defaults) throw new TypeError('createSettingsStore: defaults are required');
  if (!filePath) throw new TypeError('createSettingsStore: filePath is required');

  /** @type {object} */
  let overrides = {};

  try {
    overrides = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!isPlainObject(overrides)) overrides = {};
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
    validate(defaults, patch);
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
