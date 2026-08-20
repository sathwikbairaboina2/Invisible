'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { nextCorner, cornerBounds } = require('../src/main/overlay-position');

const WORK = { x: 0, y: 0, width: 1920, height: 1040 };
const WIN = { width: 560, height: 460 };
const MARGIN = 24;

test('cycles through the four corners in order', () => {
  assert.equal(nextCorner('top-right'), 'bottom-right');
  assert.equal(nextCorner('bottom-right'), 'bottom-left');
  assert.equal(nextCorner('bottom-left'), 'top-left');
  assert.equal(nextCorner('top-left'), 'top-right');
});

test('unknown or missing corner starts the cycle at top-right', () => {
  assert.equal(nextCorner(undefined), 'top-right');
  assert.equal(nextCorner('middle'), 'top-right');
});

test('corner bounds respect the margin on every side', () => {
  assert.deepEqual(cornerBounds('top-left', WORK, WIN, MARGIN), { x: 24, y: 24 });
  assert.deepEqual(cornerBounds('top-right', WORK, WIN, MARGIN), { x: 1920 - 560 - 24, y: 24 });
  assert.deepEqual(cornerBounds('bottom-left', WORK, WIN, MARGIN), { x: 24, y: 1040 - 460 - 24 });
  assert.deepEqual(cornerBounds('bottom-right', WORK, WIN, MARGIN), {
    x: 1920 - 560 - 24,
    y: 1040 - 460 - 24,
  });
});

test('a work area with an offset origin (second monitor) is honored', () => {
  const second = { x: 1920, y: 120, width: 2560, height: 1320 };
  assert.deepEqual(cornerBounds('top-left', second, WIN, MARGIN), { x: 1944, y: 144 });
  assert.deepEqual(cornerBounds('bottom-right', second, WIN, MARGIN), {
    x: 1920 + 2560 - 560 - 24,
    y: 120 + 1320 - 460 - 24,
  });
});
