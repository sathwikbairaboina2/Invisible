'use strict';

/**
 * Re-answer every question from an exported notes file with the full corpus
 * and no time pressure, writing a said-vs-rehearsed comparison next to it.
 *
 *   npm run replay -- "C:\...\Documents\Invisible\interview-2026-08-20.md"
 */

const fs = require('node:fs');
const path = require('node:path');

const config = require('../src/main/config');
const { parseExport, renderReplay } = require('../src/main/replay');
const { createOllamaClient } = require('../src/ollama/client');
const { createRetrievalClient } = require('../src/qdrant/client');

async function main() {
  const input = process.argv[2];
  if (!input || !fs.existsSync(input)) {
    throw new Error('usage: npm run replay -- <exported-notes.md>');
  }

  const entries = parseExport(fs.readFileSync(input, 'utf8'));
  if (entries.length === 0) {
    throw new Error('no "Questions & answers" section found in that file');
  }
  console.log(`[replay] ${entries.length} questions from ${path.basename(input)}`);

  const ollama = createOllamaClient({
    baseUrl: config.agent.ollamaBaseUrl,
    model: config.agent.model,
    temperature: config.agent.temperature,
    // Off the live latency path, so a fuller answer is affordable here.
    numPredict: 400,
  });
  const retrieval = createRetrievalClient({
    url: config.agent.qdrant.url,
    collection: config.agent.qdrant.collection,
    topK: config.agent.qdrant.topK,
    scoreThreshold: config.agent.qdrant.scoreThreshold,
    ollamaBaseUrl: config.agent.ollamaBaseUrl,
    embedModel: config.agent.embedModel,
  });

  const results = [];
  for (const entry of entries) {
    let retrieved = [];
    try {
      retrieved = await retrieval.search(entry.question);
    } catch {
      // No corpus is fine; the rehearsal is just less personal.
    }

    let better = '';
    try {
      for await (const token of ollama.stream({
        utterance: entry.question,
        retrieved,
        mode: 'interview',
        stylePreset: 'spoken',
      })) {
        better += token;
      }
    } catch (err) {
      console.error(`[replay] model failed on "${entry.question}": ${err.message}`);
    }

    results.push({ ...entry, better: better.trim() });
    console.log(`[replay] ${entry.question}`);
  }

  const out = input.replace(/\.md$/i, '') + '-replay.md';
  fs.writeFileSync(out, renderReplay(results), 'utf8');
  console.log(`[replay] written: ${out}`);
}

main().catch((err) => {
  console.error(`[replay] ${err.message}`);
  process.exit(1);
});
