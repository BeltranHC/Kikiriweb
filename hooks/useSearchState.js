import { useState, useRef, useEffect, useCallback } from 'react';
import { normalizeSearchState, readSearchState, writeSearchState } from '@/lib/view-state.mjs';

export function useSearchState(key) {
  const [state, setState] = useState({ query: '', page: 1 });
  const [ready, setReady] = useState(false);
  const current = useRef(state);
  useEffect(() => {
    let restored;
    try { restored = readSearchState(window.sessionStorage, key); }
    catch { restored = normalizeSearchState(null); }
    current.current = restored;
    setState(restored);
    setReady(true);
  }, [key]);
  const update = useCallback(value => {
    const next = normalizeSearchState(value);
    current.current = next;
    setState(next);
    try { writeSearchState(window.sessionStorage, key, next); } catch { /* Keep the in-memory draft. */ }
  }, [key]);
  const setQuery = useCallback(query => update({ query, page: 1 }), [update]);
  const setPage = useCallback(page => update({ ...current.current, page }), [update]);
  return { ...state, ready, setQuery, setPage };
}
