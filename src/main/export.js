'use strict';

/**
 * Deterministic markdown from what the meeting log already holds — no model
 * call at export time, so the file appears instantly and works offline.
 */

function formatClock(at, startedAt) {
  const seconds = Math.max(0, Math.round((at - startedAt) / 1000));
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

/**
 * @param {{snapshot: {startedAt: number, transcript: Array, qa: Array},
 *          session: {mode: string, profile: object},
 *          summary?: string}} args
 * @returns {string} markdown
 */
function renderExport({ snapshot, session, summary = '' } = {}) {
  const mode = session?.mode === 'interview' ? 'interview' : 'meeting';
  const profile = session?.profile ?? {};
  const lines = [];

  lines.push(`# Invisible — ${mode} notes`);
  lines.push('');
  lines.push(`- Date: ${new Date(snapshot.startedAt).toLocaleString()}`);
  if (mode === 'interview') {
    const target = [profile.role, profile.company].filter(Boolean).join(' at ');
    if (target) lines.push(`- Interview: ${target}`);
  } else {
    if (profile.title) lines.push(`- Meeting: ${profile.title}`);
    if (profile.attendees) lines.push(`- Attendees: ${profile.attendees}`);
    if (profile.agenda) lines.push(`- Agenda: ${profile.agenda}`);
  }
  lines.push(`- Questions answered: ${snapshot.qa.length}`);
  lines.push('');

  if (summary) {
    lines.push('## Earlier summary');
    lines.push('');
    lines.push(summary);
    lines.push('');
  }

  if (mode === 'interview') {
    // Interrupted or unanswered questions are the ones worth rehearsing again.
    const drills = snapshot.qa.filter(
      (entry) => entry.question && (entry.aborted || entry.answer.trim() === '')
    );
    if (drills.length > 0) {
      lines.push('## Drill these');
      lines.push('');
      for (const entry of drills) lines.push(`- ${entry.question}`);
      lines.push('');
    }
  }

  if (snapshot.qa.length > 0) {
    lines.push('## Questions & answers');
    lines.push('');
    for (const entry of snapshot.qa) {
      lines.push(`### ${entry.question || '(untranscribed question)'}`);
      lines.push('');
      lines.push(entry.answer.trim() + (entry.aborted ? ' *(interrupted)*' : ''));
      if (entry.followup) {
        lines.push('');
        lines.push(`> predicted follow-up: ${entry.followup}`);
      }
      lines.push('');
    }
  }

  if (snapshot.transcript.length > 0) {
    lines.push('## Transcript');
    lines.push('');
    for (const line of snapshot.transcript) {
      const who = line.speaker === 'user' ? 'you' : 'them';
      lines.push(`- ${formatClock(line.at, snapshot.startedAt)} **${who}**: ${line.text}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

module.exports = { renderExport };
