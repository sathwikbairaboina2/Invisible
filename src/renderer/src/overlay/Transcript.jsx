import React, { useEffect, useRef } from 'react';

/**
 * @param {{lines: Array<{speaker: string, text: string, key: number}>}} props
 */
export function Transcript({ lines }) {
  const scroller = useRef(null);

  // Pinned to the newest line. Without this the panel silently stops updating
  // as soon as it overflows.
  useEffect(() => {
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [lines]);

  if (lines.length === 0) return null;

  return (
    <div className="transcript">
      <div className="transcript-scroll" ref={scroller}>
        {lines.map((line) => (
          <div className="line" key={line.key} data-speaker={line.speaker}>
            <span className="who">{line.speaker === 'user' ? 'you' : 'them'}</span>
            <span>{line.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
