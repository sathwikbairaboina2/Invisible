'use strict';

/**
 * Serial task queue with a bounded backlog.
 *
 * One whisper-server holds one model, so concurrent requests would queue inside
 * the server anyway — but invisibly, with no cap and no way to shed load. Doing
 * it here makes the backlog observable and boundable.
 *
 * When the backlog is full the *oldest* waiting task is dropped, not the
 * newest. A stale utterance is worth less than a fresh one: answering a
 * question from a minute ago is worse than missing it.
 *
 * @param {{maxDepth?: number, onDrop?: (dropped: number) => void}} options
 */
function createSerialQueue({ maxDepth = 8, onDrop } = {}) {
  /** @type {Array<{task: Function, resolve: Function, reject: Function}>} */
  const waiting = [];
  let running = false;

  async function drain() {
    if (running) return;
    running = true;

    while (waiting.length > 0) {
      const entry = waiting.shift();
      try {
        entry.resolve(await entry.task());
      } catch (err) {
        // Rejecting this task must not break the loop, or one bad utterance
        // would wedge every later one.
        entry.reject(err);
      }
    }

    running = false;
  }

  function push(task) {
    return new Promise((resolve, reject) => {
      waiting.push({ task, resolve, reject });

      while (waiting.length > maxDepth) {
        const evicted = waiting.shift();
        evicted.reject(new Error('dropped: queue full'));
        onDrop?.(1);
      }

      drain();
    });
  }

  return {
    push,
    /** Tasks waiting, excluding the one currently running. */
    size: () => waiting.length,
    pending: () => running,
  };
}

module.exports = { createSerialQueue };
