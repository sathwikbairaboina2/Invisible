import React, { useMemo } from 'react';
import { parseAnswer } from '../parseAnswer.js';

/**
 * @param {{answer: string, streaming: boolean, aborted: boolean}} props
 */
export function Answer({ answer, streaming, aborted }) {
  // Runs on every token, so memoise on the raw text rather than reparsing an
  // unchanged string when sibling state updates.
  const { lead, bullets, code } = useMemo(() => parseAnswer(answer), [answer]);

  if (!lead && bullets.length === 0 && !code) {
    return (
      <div className="answer">
        <p className="placeholder">{streaming ? 'thinking…' : 'listening for a question'}</p>
      </div>
    );
  }

  return (
    <div className="answer">
      <p className="lead">
        {renderInlineCode(lead)}
        {streaming && bullets.length === 0 ? <span className="cursor">▌</span> : null}
        {aborted ? ' …' : null}
      </p>
      {code ? <pre className="code-block">{code}</pre> : null}
      {bullets.length > 0 ? (
        <ul className="bullets">
          {bullets.map((bullet, i) => (
            <li key={i}>
              <span>{renderInlineCode(bullet)}</span>
            </li>
          ))}
          {streaming ? (
            <li aria-hidden="true">
              <span className="cursor">▌</span>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Renders `backticked` spans as code. Deliberately not a markdown renderer:
 * the prompt bans everything else, and a full parser would be a dependency and
 * an injection surface for model output.
 *
 * @param {string} text
 */
function renderInlineCode(text) {
  const parts = String(text).split(/(`[^`]+`)/g);
  return parts.map((part, i) =>
    part.startsWith('`') && part.endsWith('`') && part.length > 2 ? (
      <code key={i}>{part.slice(1, -1)}</code>
    ) : (
      part
    )
  );
}
