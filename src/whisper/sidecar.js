'use strict';

const path = require('node:path');
const net = require('node:net');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

/** Resolves once `port` accepts a connection, or rejects on timeout. */
function waitForPort(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve, reject) => {
    function attempt() {
      const socket = net.connect({ host, port });

      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });

      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline) {
          reject(new Error(`timed out after ${timeoutMs} ms waiting for ${host}:${port}`));
          return;
        }
        setTimeout(attempt, 250);
      });
    }
    attempt();
  });
}

/**
 * Owns the whisper-server child process.
 *
 * Readiness is detected by TCP connect rather than by parsing stdout, because
 * the exact "listening" line is a whisper.cpp implementation detail that has
 * changed between releases. The port either accepts connections or it does not.
 *
 * @param {{config: object, root?: string,
 *          onLog?: (line: string) => void,
 *          onStateChange?: (state: string, detail?: string) => void}} options
 */
function createSidecar({ config, root = process.cwd(), onLog, onStateChange } = {}) {
  const binary = path.resolve(root, config.binary);
  const model = path.resolve(root, config.model);
  const baseUrl = `http://${config.host}:${config.port}`;

  let child = null;
  let state = 'stopped';
  let restarts = 0;
  /** Set during stop() so the exit handler does not treat it as a crash. */
  let stopping = false;

  function setState(next, detail) {
    state = next;
    onStateChange?.(next, detail);
  }

  /** Fails early with the actionable message rather than an ENOENT from spawn. */
  function checkInstalled() {
    if (!fs.existsSync(binary)) {
      throw new Error(`whisper-server not found at ${binary} — run \`npm run fetch-whisper\``);
    }
    if (!fs.existsSync(model)) {
      throw new Error(`model not found at ${model} — run \`npm run fetch-whisper\``);
    }
  }

  function spawnChild() {
    const args = [
      '--host', config.host,
      '--port', String(config.port),
      '--model', model,
      '--threads', String(config.threads),
      '--language', config.language,
    ];

    child = spawn(binary, args, {
      // The exe loads CUDA and ggml DLLs from its own directory.
      cwd: path.dirname(binary),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const relay = (stream) => {
      stream.setEncoding('utf8');
      let buffered = '';
      stream.on('data', (chunk) => {
        buffered += chunk;
        const lines = buffered.split(/\r?\n/);
        buffered = lines.pop() ?? '';
        for (const line of lines) if (line.trim()) onLog?.(line.trim());
      });
    };
    relay(child.stdout);
    relay(child.stderr);

    child.on('exit', (code, signal) => {
      child = null;
      if (stopping) {
        setState('stopped');
        return;
      }

      const detail = `whisper-server exited (code ${code}, signal ${signal})`;
      if (restarts < config.maxRestarts) {
        restarts += 1;
        onLog?.(`${detail} — restart ${restarts}/${config.maxRestarts}`);
        // Linear backoff: a crash loop should not spin, but a one-off crash
        // should recover fast enough that the operator does not notice.
        setTimeout(() => {
          start().catch((err) => setState('failed', err.message));
        }, restarts * 1000);
      } else {
        setState('failed', `${detail}; gave up after ${config.maxRestarts} restarts`);
      }
    });

    child.on('error', (err) => {
      child = null;
      setState('failed', err.message);
    });
  }

  async function start() {
    if (state === 'ready' || state === 'starting') return;

    checkInstalled();
    setState('starting');
    spawnChild();

    try {
      await waitForPort(config.host, config.port, config.startupTimeoutMs);
    } catch (err) {
      setState('failed', err.message);
      throw err;
    }

    // A crash during model load can free the port between the connect and here.
    if (!child) {
      const message = 'whisper-server exited during startup';
      setState('failed', message);
      throw new Error(message);
    }

    restarts = 0;
    setState('ready');
  }

  async function stop() {
    stopping = true;
    if (child) {
      // The exit handler sets 'stopped'. Setting it here too would emit the
      // state change twice, and every listener would act on it twice.
      child.kill();
      child = null;
      return;
    }
    setState('stopped');
  }

  return {
    start,
    stop,
    baseUrl,
    isReady: () => state === 'ready',
    get state() {
      return state;
    },
  };
}

module.exports = { createSidecar };
