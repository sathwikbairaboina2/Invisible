'use strict';

/**
 * One-time setup: downloads the whisper.cpp cuBLAS server build and the
 * large-v3-turbo model.
 *
 * Roughly 2.3 GB total. Everything lands in bin/ and models/, both of which
 * are git-ignored. Re-running skips files that are already present and the
 * right size, so an interrupted run resumes cheaply.
 *
 * Windows only, matching the rest of the project: extraction shells out to
 * PowerShell's Expand-Archive rather than adding a zip dependency.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');

const execFileAsync = promisify(execFile);
const ROOT = path.join(__dirname, '..');

const WHISPER_VERSION = 'v1.9.2';
const ZIP_NAME = 'whisper-cublas-12.4.0-bin-x64.zip';
const ZIP_URL =
  `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_VERSION}/${ZIP_NAME}`;

const MODEL_NAME = 'ggml-large-v3-turbo.bin';
const MODEL_URL =
  `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_NAME}?download=true`;
/** Exact size from the HuggingFace API. A short file means a truncated download. */
const MODEL_BYTES = 1624555275;

const BIN_DIR = path.join(ROOT, 'bin');
const MODEL_DIR = path.join(ROOT, 'models');
const TMP_DIR = path.join(ROOT, 'bin', '.download');

function human(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

/**
 * Streams a URL to disk, reporting progress on one rewritten line.
 * Downloads to `${dest}.part` and renames on success, so an interrupted run
 * never leaves a truncated file that looks complete.
 */
async function download(url, dest, label) {
  const part = `${dest}.part`;
  const response = await fetch(url, { redirect: 'follow' });

  if (!response.ok) {
    throw new Error(`${label}: HTTP ${response.status} ${response.statusText}`);
  }
  if (!response.body) {
    throw new Error(`${label}: response had no body`);
  }

  const total = Number(response.headers.get('content-length')) || 0;
  let seen = 0;
  let lastReport = 0;

  const source = Readable.fromWeb(response.body);
  source.on('data', (chunk) => {
    seen += chunk.length;
    const now = Date.now();
    if (now - lastReport > 2000) {
      lastReport = now;
      const pct = total ? ` (${((seen / total) * 100).toFixed(1)}%)` : '';
      console.log(`[fetch] ${label}: ${human(seen)}${pct}`);
    }
  });

  await pipeline(source, fs.createWriteStream(part));
  await fsp.rename(part, dest);
  console.log(`[fetch] ${label}: ${human(seen)} done`);
}

/** True when `file` exists and, if `expectedBytes` is given, matches it. */
async function alreadyHave(file, expectedBytes) {
  try {
    const stat = await fsp.stat(file);
    if (expectedBytes && stat.size !== expectedBytes) {
      console.log(
        `[fetch] ${path.basename(file)} is ${stat.size} B, expected ${expectedBytes} B — refetching`
      );
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Recursively finds whisper-server.exe; the zip's internal layout is not documented. */
async function findServerExe(dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = await findServerExe(full);
      if (found) return found;
    } else if (entry.name.toLowerCase() === 'whisper-server.exe') {
      return full;
    }
  }
  return null;
}

async function fetchBinary() {
  const serverExe = path.join(BIN_DIR, 'whisper-server.exe');
  if (await alreadyHave(serverExe)) {
    console.log('[fetch] whisper-server.exe already present');
    return;
  }

  await fsp.mkdir(TMP_DIR, { recursive: true });
  const zipPath = path.join(TMP_DIR, ZIP_NAME);

  if (!(await alreadyHave(zipPath))) {
    await download(ZIP_URL, zipPath, ZIP_NAME);
  }

  console.log('[fetch] extracting...');
  const extractDir = path.join(TMP_DIR, 'extracted');
  await fsp.rm(extractDir, { recursive: true, force: true });
  await execFileAsync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Expand-Archive -LiteralPath "${zipPath}" -DestinationPath "${extractDir}" -Force`,
    ],
    { maxBuffer: 1024 * 1024 * 32 }
  );

  const found = await findServerExe(extractDir);
  if (!found) {
    throw new Error(
      `whisper-server.exe not found in ${ZIP_NAME}. The release layout changed; ` +
        `inspect ${extractDir} and update this script.`
    );
  }

  // The exe needs the CUDA and ggml DLLs that ship beside it, so copy the whole
  // containing directory rather than the single file.
  const sourceDir = path.dirname(found);
  await fsp.mkdir(BIN_DIR, { recursive: true });
  for (const entry of await fsp.readdir(sourceDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    await fsp.copyFile(path.join(sourceDir, entry.name), path.join(BIN_DIR, entry.name));
  }

  const copied = (await fsp.readdir(BIN_DIR)).length;
  console.log(`[fetch] installed ${copied} files into bin/`);

  await fsp.rm(TMP_DIR, { recursive: true, force: true });
}

async function fetchModel() {
  const model = path.join(MODEL_DIR, MODEL_NAME);
  if (await alreadyHave(model, MODEL_BYTES)) {
    console.log('[fetch] model already present');
    return;
  }
  await fsp.mkdir(MODEL_DIR, { recursive: true });
  await download(MODEL_URL, model, MODEL_NAME);

  const stat = await fsp.stat(model);
  if (stat.size !== MODEL_BYTES) {
    await fsp.rm(model, { force: true });
    throw new Error(
      `model download was ${stat.size} B, expected ${MODEL_BYTES} B — deleted, re-run`
    );
  }
}

async function main() {
  if (process.platform !== 'win32') {
    throw new Error('This script targets Windows x64, matching the rest of the project.');
  }
  await fetchBinary();
  await fetchModel();
  console.log('[fetch] done');
}

main().catch((err) => {
  console.error(`\n[fetch] ${err.message}`);
  process.exit(1);
});
