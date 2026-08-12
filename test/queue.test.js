'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createSerialQueue } = require('../src/whisper/queue');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('runs tasks one at a time, in order', async () => {
  const queue = createSerialQueue({ maxDepth: 10 });
  const order = [];

  const results = await Promise.all([
    queue.push(async () => {
      order.push('a-start');
      await delay(30);
      order.push('a-end');
      return 'a';
    }),
    queue.push(async () => {
      order.push('b-start');
      await delay(5);
      order.push('b-end');
      return 'b';
    }),
  ]);

  assert.deepEqual(results, ['a', 'b']);
  // b must not start before a finishes, or two requests hit one model.
  assert.deepEqual(order, ['a-start', 'a-end', 'b-start', 'b-end']);
});

test('a failing task does not stall the queue', async () => {
  const queue = createSerialQueue({ maxDepth: 10 });

  const failed = queue.push(async () => {
    throw new Error('boom');
  });
  const after = queue.push(async () => 'still works');

  await assert.rejects(() => failed, /boom/);
  assert.equal(await after, 'still works');
});

test('drops the oldest waiting task when the backlog is full', async () => {
  const dropped = [];
  const queue = createSerialQueue({ maxDepth: 2, onDrop: () => dropped.push(1) });

  // Occupies the runner, so everything else waits.
  const running = queue.push(async () => {
    await delay(50);
    return 'running';
  });

  const first = queue.push(async () => 'first');
  const second = queue.push(async () => 'second');
  const third = queue.push(async () => 'third');

  // maxDepth is 2, so pushing `third` evicts `first`.
  await assert.rejects(() => first, /dropped: queue full/);
  assert.equal(dropped.length, 1);

  assert.equal(await running, 'running');
  assert.equal(await second, 'second');
  assert.equal(await third, 'third');
});

test('reports how much work is outstanding', async () => {
  const queue = createSerialQueue({ maxDepth: 10 });
  assert.equal(queue.size(), 0);
  assert.equal(queue.pending(), false);

  const running = queue.push(async () => {
    await delay(20);
    return 1;
  });
  const second = queue.push(async () => 2);

  assert.equal(queue.pending(), true);
  assert.equal(queue.size(), 1, 'one waiting behind the running task');

  await Promise.all([running, second]);
});
