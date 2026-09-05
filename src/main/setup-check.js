'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

/** Exact size of ggml-large-v3-turbo.bin, from the HuggingFace API. */
const WHISPER_MODEL_BYTES = 1_624_555_275;

/**
 * Probes every dependency and reports what is missing, with the command that
 * fixes it.
 *
 * Deliberately read-only. Every fix here either starts a container, downloads
 * gigabytes, or touches a personal corpus; doing any of that from a click in a
 * window the operator may have opened just to read a shortcut would be worse
 * than printing the command.
 *
 * All callers are injected so the whole matrix is testable with nothing
 * running.
 *
 * @param {{config: object, fileExists?: Function, fileSize?: Function,
 *          dockerPs?: Function, ollamaProbe?: Function, qdrantProbe?: Function,
 *          root?: string}} deps
 * @returns {Promise<{ok: boolean, checks: Array<{id: string, label: string,
 *          state: 'ok'|'missing'|'error', detail: string, fix: string|null}>}>}
 */
async function checkSetup(deps) {
  const {
    config,
    root = process.cwd(),
    fileExists = (p) => fs.existsSync(p),
    fileSize = (p) => fs.statSync(p).size,
    dockerPs = defaultDockerPs,
    ollamaProbe,
    qdrantProbe,
  } = deps;

  const checks = [];
  const add = (id, label, state, detail, fix = null) =>
    checks.push({ id, label, state, detail, fix });

  // --- Docker -------------------------------------------------------------
  /** @type {string[] | null} null means the daemon could not be reached. */
  let containers = null;
  try {
    containers = await dockerPs();
    add('docker', 'Docker running', 'ok', `${containers.length} container(s) up`);
  } catch (err) {
    add(
      'docker',
      'Docker running',
      'error',
      `Docker Desktop is not reachable — ${err.message}`,
      'Start Docker Desktop'
    );
  }

  // --- containers ---------------------------------------------------------
  // When Docker is down every downstream check would fail for the same reason.
  // Reporting six red rows for one cause buries the actual problem.
  const blocked = containers === null;

  for (const [id, name, label] of [['qdrant-container', 'invisible-qdrant', 'Qdrant container']]) {
    if (blocked) {
      add(id, label, 'missing', 'Blocked: Docker is not running', null);
    } else if (containers.includes(name)) {
      add(id, label, 'ok', `${name} is up`);
    } else {
      add(id, label, 'missing', `${name} is not running`, 'npm run services:up');
    }
  }

  // --- Ollama model -------------------------------------------------------
  // Ollama is the host install, not a container, so Docker being down does not
  // block it: probe the daemon directly.
  {
    try {
      const result = await ollamaProbe();
      if (!result.ok) {
        add(
          'ollama-model',
          'Answer model pulled',
          'error',
          `Ollama unreachable at ${config.agent.ollamaBaseUrl}`,
          'Start the Ollama app'
        );
      } else if (!result.hasModel) {
        add(
          'ollama-model',
          'Answer model pulled',
          'missing',
          `${config.agent.model} is not pulled`,
          'npm run ollama:pull'
        );
      } else {
        add('ollama-model', 'Answer model pulled', 'ok', config.agent.model);
      }
    } catch (err) {
      // One broken probe must not blank the whole panel.
      add('ollama-model', 'Answer model pulled', 'error', err.message, 'npm run ollama:pull');
    }
  }

  // --- whisper ------------------------------------------------------------
  const binary = path.resolve(root, config.whisper.binary);
  if (fileExists(binary)) {
    add('whisper-binary', 'Whisper binary', 'ok', config.whisper.binary);
  } else {
    add(
      'whisper-binary',
      'Whisper binary',
      'missing',
      `Not found at ${config.whisper.binary}`,
      'npm run fetch-whisper'
    );
  }

  const model = path.resolve(root, config.whisper.model);
  if (!fileExists(model)) {
    add(
      'whisper-model',
      'Whisper model',
      'missing',
      `Not found at ${config.whisper.model}`,
      'npm run fetch-whisper'
    );
  } else {
    let size = 0;
    try {
      size = fileSize(model);
    } catch {
      size = 0;
    }
    if (size !== WHISPER_MODEL_BYTES) {
      // An interrupted 1.6 GB download leaves a file that exists and is useless.
      add(
        'whisper-model',
        'Whisper model',
        'error',
        `Incomplete download: ${size} bytes, expected ${WHISPER_MODEL_BYTES}`,
        'npm run fetch-whisper'
      );
    } else {
      add('whisper-model', 'Whisper model', 'ok', 'large-v3-turbo, 1.6 GB');
    }
  }

  // --- corpus -------------------------------------------------------------
  if (blocked || !containers.includes('invisible-qdrant')) {
    add('corpus', 'Corpus indexed', 'missing', 'Blocked: Qdrant is not running', null);
  } else {
    try {
      const result = await qdrantProbe();
      if (!result.ok) {
        add(
          'corpus',
          'Corpus indexed',
          'error',
          result.error ?? 'Qdrant unreachable',
          'npm run services:up'
        );
      } else if (!result.exists || result.points === 0) {
        add(
          'corpus',
          'Corpus indexed',
          'missing',
          'No documents indexed — answers will be generic',
          'npm run ingest'
        );
      } else {
        add('corpus', 'Corpus indexed', 'ok', `${result.points} chunks`);
      }
    } catch (err) {
      add('corpus', 'Corpus indexed', 'error', err.message, 'npm run ingest');
    }
  }

  // An empty corpus is excluded from readiness on purpose: the app works
  // without one, answers are simply less specific. Failing on it would train
  // the operator to ignore red. A corpus *error* still counts, because that
  // means Qdrant is broken rather than merely empty.
  const ok = checks.every(
    (check) => check.state === 'ok' || (check.id === 'corpus' && check.state === 'missing')
  );

  return { ok, checks };
}

/** Names of running containers, via the docker CLI. */
function defaultDockerPs() {
  return new Promise((resolve, reject) => {
    execFile('docker', ['ps', '--format', '{{.Names}}'], { timeout: 8000 }, (err, stdout) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(
        String(stdout)
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
      );
    });
  });
}

module.exports = { checkSetup, WHISPER_MODEL_BYTES };
