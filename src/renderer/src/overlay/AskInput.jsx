import React, { useEffect, useRef, useState } from 'react';

/**
 * Single-line question box, opened by the global askInput shortcut. The
 * overlay is interactive only while this is open; both exits restore
 * click-through so a stray box never leaves the HUD swallowing clicks.
 */
export function AskInput() {
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => window.invisible.onAskOpen(() => setOpen(true)), []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) return null;

  function close() {
    setOpen(false);
    window.invisible.setInteractive(false);
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') {
      close();
      return;
    }
    if (event.key === 'Enter') {
      const question = event.target.value.trim();
      if (question) window.invisible.ask(question);
      // Empty Enter is treated as Escape; the spoken re-ask lives on its own
      // Ctrl+Shift+Space binding and is not duplicated here.
      close();
    }
  }

  return (
    <div className="ask-input">
      <input
        ref={inputRef}
        type="text"
        placeholder="Type a question — Enter to ask, Esc to close"
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
