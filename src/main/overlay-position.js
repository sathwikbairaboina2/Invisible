'use strict';

/** Cycle order for the position hotkey; index 0 is also the fallback. */
const CORNERS = ['top-right', 'bottom-right', 'bottom-left', 'top-left'];

function nextCorner(current) {
  const index = CORNERS.indexOf(current);
  return index === -1 ? CORNERS[0] : CORNERS[(index + 1) % CORNERS.length];
}

/**
 * Window origin for a corner of a display's work area. Work areas carry their
 * own origin, so the same math lands correctly on a second monitor.
 *
 * @param {'top-right'|'bottom-right'|'bottom-left'|'top-left'} corner
 * @param {{x: number, y: number, width: number, height: number}} workArea
 * @param {{width: number, height: number}} win
 * @param {number} margin
 * @returns {{x: number, y: number}}
 */
function cornerBounds(corner, workArea, win, margin) {
  const left = workArea.x + margin;
  const right = workArea.x + workArea.width - win.width - margin;
  const top = workArea.y + margin;
  const bottom = workArea.y + workArea.height - win.height - margin;

  switch (corner) {
    case 'top-left':
      return { x: left, y: top };
    case 'bottom-left':
      return { x: left, y: bottom };
    case 'bottom-right':
      return { x: right, y: bottom };
    case 'top-right':
    default:
      return { x: right, y: top };
  }
}

module.exports = { nextCorner, cornerBounds, CORNERS };
