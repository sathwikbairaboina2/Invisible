'use strict';

/**
 * Practice replay: parse the questions back out of an exported notes file, so
 * they can be re-answered at leisure with the full corpus and no time
 * pressure, then rendered as a said-vs-rehearsed comparison.
 */

/**
 * @param {string} markdown an export produced by renderExport()
 * @returns {Array<{question: string, answer: string}>}
 */
function parseExport(markdown) {
  const text = String(markdown ?? '');
  const qaMatch = text.match(/## Questions & answers\n([\s\S]*?)(?=\n## |$)/);
  if (!qaMatch) return [];

  const entries = [];
  // Each entry: "### question" then prose until the next ### or the end.
  const blocks = qaMatch[1].split(/\n### /).slice(1);
  for (const block of blocks) {
    const lines = block.split('\n');
    const question = lines[0].trim();
    const answer = lines
      .slice(1)
      .filter((line) => !line.startsWith('> predicted follow-up:'))
      .join('\n')
      .trim();
    if (question) entries.push({ question, answer });
  }
  return entries;
}

/**
 * @param {Array<{question: string, answer: string, better: string}>} entries
 * @returns {string} markdown
 */
function renderReplay(entries) {
  const lines = ['# Invisible — practice replay', ''];
  for (const entry of entries) {
    lines.push(`## ${entry.question}`);
    lines.push('');
    lines.push('**You said:**');
    lines.push('');
    lines.push(entry.answer || '_(nothing)_');
    lines.push('');
    lines.push('**Rehearsed answer:**');
    lines.push('');
    lines.push(entry.better || '_(model unavailable)_');
    lines.push('');
  }
  return lines.join('\n');
}

module.exports = { parseExport, renderReplay };
