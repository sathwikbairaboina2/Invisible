'use strict';

/**
 * Copies runtime assets out of node_modules and into the source tree so the
 * audio worker can load them over file:// without a bundler.
 *
 * The filenames below are not guesses. @ricky0123/vad-web bundles ONNX Runtime
 * into its own bundle.min.js and then fetches four assets *by name* at runtime:
 * the worklet bundle, one of the two Silero models, and the ORT wasm glue
 * module (which in turn pulls its .wasm sibling). Those names were read out of
 * dist/bundle.min.js, so a version bump can change them.
 *
 * Every entry is therefore required. A missing asset surfaces as "the VAD never
 * starts" with no console error worth reading, so this script fails loudly
 * instead.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const JOBS = [
  {
    label: 'vad',
    from: path.join(ROOT, 'node_modules', '@ricky0123', 'vad-web', 'dist'),
    to: path.join(ROOT, 'src', 'audio', 'vendor', 'vad'),
    files: [
      // Self-contained: includes ONNX Runtime. No separate ort script tag.
      'bundle.min.js',
      // Fetched by the bundle relative to baseAssetPath.
      'vad.worklet.bundle.min.js',
      'silero_vad_v5.onnx',
      // The package's DEFAULT_MODEL is "legacy"; copied so a fallback to the
      // default does not 404.
      'silero_vad_legacy.onnx',
    ],
  },
  {
    label: 'ort',
    from: path.join(ROOT, 'node_modules', 'onnxruntime-web', 'dist'),
    to: path.join(ROOT, 'src', 'audio', 'vendor', 'ort'),
    files: [
      // vad-web imports onnxruntime-web/wasm, so this is the non-jsep build.
      // The .mjs is the glue module; it loads the .wasm sibling from the same
      // directory. Both must be present.
      'ort-wasm-simd-threaded.mjs',
      'ort-wasm-simd-threaded.wasm',
    ],
  },
];

let failed = false;

for (const job of JOBS) {
  if (!fs.existsSync(job.from)) {
    console.error(`[vendor] missing source directory: ${job.from}`);
    console.error('[vendor] run `npm install` first');
    failed = true;
    continue;
  }

  fs.mkdirSync(job.to, { recursive: true });

  for (const name of job.files) {
    const src = path.join(job.from, name);
    if (!fs.existsSync(src)) {
      console.error(`[vendor] ${job.label}: ${name} not found in ${job.from}`);
      console.error('[vendor] the package layout changed — re-check dist/ and update this script');
      failed = true;
      continue;
    }
    const dest = path.join(job.to, name);
    fs.copyFileSync(src, dest);
    const kb = Math.round(fs.statSync(dest).size / 1024);
    console.log(`[vendor] ${job.label}: ${name} (${kb} KB)`);
  }
}

if (failed) {
  console.error('[vendor] one or more assets could not be copied — the audio worker will not start.');
  process.exit(1);
}

console.log('[vendor] done');
