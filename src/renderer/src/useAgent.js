import { useEffect, useRef, useState } from 'react';

/**
 * Owns every piece of state the overlay renders, and is the only place that
 * touches the preload bridge.
 *
 * @returns {{status: object, turn: {id: string|null, streaming: boolean, aborted: boolean},
 *            answer: string, transcript: Array<{speaker: string, text: string, key: number}>,
 *            error: {scope: string, message: string}|null}}
 */
export function useAgent() {
  const [status, setStatus] = useState({
    capturing: false,
    stt: 'stopped',
    llm: 'unknown',
    rag: 'unknown',
    dropped: 0,
  });
  const [turn, setTurn] = useState({ id: null, streaming: false, aborted: false });
  const [answer, setAnswer] = useState('');
  const [transcript, setTranscript] = useState([]);
  const [error, setError] = useState(null);

  // Read inside token handling without making it a dependency, so the
  // subscription is established exactly once.
  const activeTurn = useRef(null);
  const nextKey = useRef(0);

  useEffect(() => {
    const api = window.invisible;
    const off = [];

    off.push(api.onStatus((next) => setStatus((prev) => ({ ...prev, ...next }))));

    off.push(
      api.onTurnStart((next) => {
        activeTurn.current = next.turnId;
        setTurn({ id: next.turnId, streaming: true, aborted: false });
        setAnswer('');
      })
    );

    off.push(
      api.onToken(({ turnId, token }) => {
        // A superseded turn keeps emitting for a tick. Dropping its tokens is
        // what stops two answers interleaving in one element.
        if (turnId !== activeTurn.current) return;
        setAnswer((prev) => prev + token);
      })
    );

    off.push(
      api.onTurnEnd((next) => {
        if (next.turnId !== activeTurn.current) return;
        setTurn({ id: next.turnId, streaming: false, aborted: Boolean(next.aborted) });
      })
    );

    off.push(
      api.onTranscriptFinal((segment) => {
        setTranscript((prev) => {
          const line = { ...segment, key: nextKey.current++ };
          const merged = [...prev, line];
          // Bounded the same way graph state is.
          return merged.length > 40 ? merged.slice(merged.length - 40) : merged;
        });
      })
    );

    off.push(api.onError((next) => setError(next)));
    off.push(
      api.onMode((mode) => setStatus((prev) => ({ ...prev, interactive: mode.interactive })))
    );

    api.ready();

    // Every on* returns its unsubscribe; without this a hot reload would stack
    // duplicate listeners on the same channels.
    return () => off.forEach((unsubscribe) => unsubscribe());
  }, []);

  return { status, turn, answer, transcript, error };
}
